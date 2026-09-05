package com.tabaaq.mobile.data.sync

import android.content.Context
import com.tabaaq.mobile.core.catalog.BatchRow
import com.tabaaq.mobile.core.catalog.CatalogMapping
import com.tabaaq.mobile.core.catalog.CatalogSnapshot
import com.tabaaq.mobile.core.catalog.CategoryRow
import com.tabaaq.mobile.core.catalog.ProductRow
import com.tabaaq.mobile.core.inventory.InventoryHttp
import com.tabaaq.mobile.core.inventory.ReplicaName
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.config.AppConfig
import com.tabaaq.mobile.data.network.HttpSupport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonArrayBuilder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.math.min
import kotlin.random.Random

data class SyncUiState(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val downloading: Boolean = false,
    val hasSynced: Boolean? = null,
    val lastSyncedAtMillis: Long? = null,
    val error: String? = null,
)

class CatalogSyncSession(
    context: Context,
    private val config: AppConfig,
    private val auth: AuthRepository,
    private val http: HttpSupport,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var database: NativeReplicaDatabase? = null
    private var coordinator: Job? = null
    private var liveJob: Job? = null
    private val mutationLock = Mutex()
    private var socket: WebSocket? = null
    @Volatile private var socketConnected = false
    private var retryDelayMs = 15_000L

    private val _snapshot = MutableStateFlow(CatalogSnapshot(emptyList(), emptyList()))
    val snapshot: StateFlow<CatalogSnapshot> = _snapshot
    private val _sync = MutableStateFlow(SyncUiState())
    val sync: StateFlow<SyncUiState> = _sync

    suspend fun start(organizationId: String) {
        stop()
        val scopeId = ReplicaName.scope(config.apiUrl, organizationId)
        val db = NativeReplicaDatabase.open(appContext, scopeId)
        database = db
        publish()
        connectLiveSocket(organizationId)
        coordinator = scope.launch { coordinate() }
        wake.trySend(Unit)
    }

    suspend fun persistCategory(row: CategoryRow) = persist("category", row.id, categoryJson(row), row.operationId, row.organizationId, row.deviceId, row.updatedByUserId, row.updatedAt)

    suspend fun persistProduct(row: ProductRow, insert: Boolean) = persist("product", row.id, productJson(row), row.operationId, row.organizationId, row.deviceId, row.updatedByUserId, row.updatedAt)

    suspend fun persistBatch(row: BatchRow, insert: Boolean) = persist("batch", row.id, batchJson(row), row.operationId, row.organizationId, row.deviceId, row.updatedByUserId, row.updatedAt)

    suspend fun refresh() { wake.trySend(Unit) }

    suspend fun stop() {
        liveJob?.cancelAndJoin()
        liveJob = null
        coordinator?.cancelAndJoin()
        coordinator = null
        socket?.close(1000, "session stopped")
        socket = null
        socketConnected = false
        database?.close()
        database = null
        _snapshot.value = CatalogSnapshot(emptyList(), emptyList())
        _sync.value = SyncUiState()
    }

    private suspend fun persist(entity: String, id: String, row: JsonObject, operationId: String, organizationId: String, deviceId: String, actorUserId: String, occurredAt: Long) {
        val db = database ?: error("Inventory is not open.")
        withContext(Dispatchers.IO) { mutationLock.withLock {
            db.database.beginTransaction()
            try {
                val command = buildJsonObject {
                    put("operationId", operationId); put("organizationId", organizationId); put("deviceId", deviceId)
                    put("actorUserId", actorUserId); put("occurredAt", occurredAt); put("entity", entity)
                    put("rows", buildJsonArray { add(row) })
                }
                db.enqueue(command.toString(), operationId)
                db.database.setTransactionSuccessful()
            } finally { db.database.endTransaction() }
            publish()
            wake.trySend(Unit)
        } }
    }

    private suspend fun coordinate() {
        while (true) {
            val wait = if (socketConnected) 5 * 60_000L else retryDelayMs
            withTimeoutOrNull(wait + jitter(wait)) { wake.receive() }
            runCatching { syncOnce() }.onFailure { error ->
                if (error is CancellationException) throw error
                _sync.value = _sync.value.copy(connected = false, connecting = false, downloading = false, error = error.message ?: "Sync failed")
                retryDelayMs = min(60_000L, retryDelayMs * 2)
            }
        }
    }

    private suspend fun syncOnce() {
        val db = database ?: return
        val token = auth.accessToken() ?: return
        _sync.value = _sync.value.copy(connecting = true, error = null)
        upload(db, token)
        _sync.value = _sync.value.copy(connecting = false, downloading = true)
        if (!db.hasSynced()) bootstrap(db, token)
        pullDrain(db, token)
        publish()
        retryDelayMs = 15_000L
        _sync.value = _sync.value.copy(connected = true, connecting = false, downloading = false, hasSynced = db.hasSynced(), lastSyncedAtMillis = System.currentTimeMillis(), error = null)
    }

    private suspend fun upload(db: NativeReplicaDatabase, token: String) {
        while (true) {
        val entries = db.pendingCommands()
        if (entries.isEmpty()) return
        val body = buildJsonObject {
            put("epoch", 2)
            put("commands", buildJsonArray { entries.forEach { add(buildJsonObject { put("kind", "catalogWrite"); put("command", json.parseToJsonElement(it.command)) }) } })
        }
        val result = requestJson("${InventoryHttp.apiRoot(config.apiUrl)}/inventory/batch", body.toString(), token, "Inventory batch upload failed.")
        result["results"]?.jsonArray?.forEachIndexed { index, item ->
            val entry = entries.getOrNull(index) ?: return@forEachIndexed
            when (item.jsonObject["status"]?.jsonPrimitive?.contentOrNull) {
                "accepted" -> db.markAccepted(entry.operationId, item.jsonObject["txid"]!!.jsonPrimitive.longOrNull ?: error("Missing replication receipt"))
                "rejected" -> {
                    val message = item.jsonObject["message"]?.jsonPrimitive?.contentOrNull ?: "Inventory write rejected"
                    db.markRejected(entry.operationId, message)
                    error(message)
                }
            }
        }
            }
    }

    private suspend fun bootstrap(db: NativeReplicaDatabase, token: String) {
        var request = buildJsonObject {
            put("epoch", 2); put("slices", buildJsonArray { add("catalog"); add("sales") })
            db.bootstrapId()?.let { id -> put("bootstrap", buildJsonObject { put("id", id); put("offset", db.bootstrapOffset()) }) }
        }
        while (true) {
            val result = requestJson("${InventoryHttp.apiRoot(config.apiUrl)}/inventory/snapshot", request.toString(), token, "Inventory snapshot failed.")
            if (result["resetRequired"]?.jsonPrimitive?.booleanOrNull == true) {
                db.clearReplicaPreservingOutbox()
                request = buildJsonObject { put("epoch", 2); put("slices", buildJsonArray { add("catalog"); add("sales") }) }
                continue
            }
            db.transaction {
            result["changes"]?.jsonArray?.forEach { db.stageBootstrap(it.toSyncChange()) }
            val bootstrap = result["bootstrap"]?.jsonObject
            if (bootstrap == null) error("Snapshot continuation missing")
            if (bootstrap["done"]?.jsonPrimitive?.booleanOrNull == true) {
                db.activateBootstrap(setOf("catalog", "sales"))
                result["cursor"]?.jsonPrimitive?.longOrNull?.let { db.setCursor(it); db.setPullCursor(it) }
                db.setHasSynced(true); db.clearBootstrap(); db.removeAcknowledged()
            } else {
                db.setBootstrap(bootstrap["id"]!!.jsonPrimitive.content, bootstrap["nextOffset"]!!.jsonPrimitive.longOrNull ?: error("Invalid snapshot offset"))
            }
            }
            if (db.hasSynced()) return
            val bootstrap = result["bootstrap"]!!.jsonObject
            val id = bootstrap["id"]?.jsonPrimitive?.contentOrNull ?: error("Snapshot bootstrap did not include an id")
            val offset = bootstrap["nextOffset"]?.jsonPrimitive?.longOrNull ?: error("Snapshot bootstrap did not include nextOffset")
            request = buildJsonObject {
                put("epoch", 2); put("slices", buildJsonArray { add("catalog"); add("sales") })
                put("bootstrap", buildJsonObject { put("id", id); put("offset", offset) })
            }
        }
    }

    private suspend fun pullDrain(db: NativeReplicaDatabase, token: String) {
        var more = true
        while (more) {
            val body = buildJsonObject { put("epoch", 2); put("cursor", db.pullCursor()); put("slices", buildJsonArray { add("catalog"); add("sales") }) }
            val result = requestJson("${InventoryHttp.apiRoot(config.apiUrl)}/inventory/pull", body.toString(), token, "Inventory pull failed.")
            if (result["resetRequired"]?.jsonPrimitive?.booleanOrNull == true) {
                db.clearReplicaPreservingOutbox(); db.setEpoch(result["epoch"]?.jsonPrimitive?.intOrNull ?: 2); bootstrap(db, token); return
            }
            db.transaction {
            val changes = result["changes"]?.jsonArray ?: JsonArray(emptyList())
            val parsed = changes.map { it.toSyncChange() }
            parsed.forEach(db::stageChange)
            val nextCursor = result["cursor"]?.jsonPrimitive?.longOrNull ?: db.pullCursor()
            db.setPullCursor(nextCursor)
            val end = result["transactionEnd"]?.jsonPrimitive?.longOrNull
            if (end == null || nextCursor >= end) {
                db.applyStagedChanges(); db.setCursor(nextCursor)
                db.removeAcknowledged()
                }
            more = result["hasMore"]?.jsonPrimitive?.booleanOrNull == true
            }
        }
    }

    private fun connectLiveSocket(organizationId: String) {
        val base = config.apiUrl.trimEnd('/').replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
        liveJob = scope.launch {
            var retry = 1_000L
            while (true) {
                try {
                    val token = auth.accessToken() ?: error("Session expired")
                    val ticket = requestJson("${InventoryHttp.apiRoot(config.apiUrl)}/inventory/live-ticket", "{}", token, "Live ticket failed.")
                    val value = ticket["ticket"]!!.jsonPrimitive.content
                    val encodedOrg = java.net.URLEncoder.encode(organizationId, "UTF-8")
                    val encodedTicket = java.net.URLEncoder.encode(value, "UTF-8")
                    val closed = CompletableDeferred<Unit>()
                    socket = http.client.newWebSocket(http.request("$base/api/inventory/live?organizationId=$encodedOrg&ticket=$encodedTicket", accessToken = token), object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) { socketConnected = true; retry = 1_000L; wake.trySend(Unit) }
                        override fun onMessage(webSocket: WebSocket, text: String) { wake.trySend(Unit) }
                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason); closed.complete(Unit) }
                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(Unit) }
                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(Unit) }
                    })
                    closed.await()
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) { }
                finally { socketConnected = false; socket?.cancel(); socket = null }
                delay(retry + jitter(retry))
                retry = min(30_000L, retry * 2)
            }
        }
    }

    private suspend fun requestJson(url: String, body: String, token: String, message: String): JsonObject = withContext(Dispatchers.IO) {
        http.execute(http.request(url, method = "POST", body = body, accessToken = token)).use { response ->
            http.decodeOrThrow(response, { json.parseToJsonElement(it).jsonObject }, message)
        }
    }

    private fun publish() {
        val db = database ?: return
        _snapshot.value = CatalogMapping.snapshotFromRows(db.rows("product").mapNotNull(::productRow), db.rows("category").mapNotNull(::categoryRow), db.rows("batch").mapNotNull(::batchRow))
    }

    private fun productRow(row: JsonObject) = runCatching { ProductRow(row.string("id"), row.string("name"), row.string("categoryId"), row.stringOrNull("aisle"), row.stringOrNull("composition"), row.stringOrNull("strength"), row.long("unitsPerPack"), row.longOrNull("purchasePrice"), row.longOrNull("retailPrice"), row.longOrNull("unitPrice"), row.bool("visible"), row.string("organizationId"), row.string("createdByUserId"), row.string("updatedByUserId"), row.string("deviceId"), row.string("operationId"), row.long("rowVersion"), row.long("createdAt"), row.long("updatedAt"), row.longOrNull("deletedAt")) }.getOrNull()
    private fun categoryRow(row: JsonObject) = runCatching { CategoryRow(row.string("id"), row.string("name"), row.bool("tracksPacks"), row.string("organizationId"), row.string("createdByUserId"), row.string("updatedByUserId"), row.string("deviceId"), row.string("operationId"), row.long("rowVersion"), row.long("createdAt"), row.long("updatedAt"), row.longOrNull("deletedAt")) }.getOrNull()
    private fun batchRow(row: JsonObject) = runCatching { BatchRow(row.string("id"), row.string("productId"), row.stringOrNull("batchNumber"), row.longOrNull("expiresAt"), row.long("packQuantity"), row.long("unitQuantity"), row.string("organizationId"), row.string("createdByUserId"), row.string("updatedByUserId"), row.string("deviceId"), row.string("operationId"), row.long("rowVersion"), row.long("createdAt"), row.long("updatedAt"), row.longOrNull("deletedAt")) }.getOrNull()

    private fun categoryJson(row: CategoryRow) = buildJsonObject { put("id", row.id); put("name", row.name); put("tracksPacks", row.tracksPacks); putCommon(row.organizationId, row.createdByUserId, row.updatedByUserId, row.deviceId, row.operationId, row.rowVersion, row.createdAt, row.updatedAt, row.deletedAt) }
    private fun productJson(row: ProductRow) = buildJsonObject { put("id", row.id); put("name", row.name); put("categoryId", row.categoryId); put("aisle", row.aisle); put("composition", row.composition); put("strength", row.strength); put("unitsPerPack", row.unitsPerPack); put("purchasePrice", row.purchasePrice); put("retailPrice", row.retailPrice); put("unitPrice", row.unitPrice); put("visible", row.visible); putCommon(row.organizationId, row.createdByUserId, row.updatedByUserId, row.deviceId, row.operationId, row.rowVersion, row.createdAt, row.updatedAt, row.deletedAt) }
    private fun batchJson(row: BatchRow) = buildJsonObject { put("id", row.id); put("productId", row.productId); put("batchNumber", row.batchNumber); put("expiresAt", row.expiresAt); put("packQuantity", row.packQuantity); put("unitQuantity", row.unitQuantity); putCommon(row.organizationId, row.createdByUserId, row.updatedByUserId, row.deviceId, row.operationId, row.rowVersion, row.createdAt, row.updatedAt, row.deletedAt) }
    private fun kotlinx.serialization.json.JsonObjectBuilder.putCommon(org: String, createdBy: String, updatedBy: String, device: String, operation: String, version: Long, created: Long, updated: Long, deleted: Long?) { put("organizationId", org); put("createdByUserId", createdBy); put("updatedByUserId", updatedBy); put("deviceId", device); put("operationId", operation); put("rowVersion", version); put("createdAt", created); put("updatedAt", updated); put("deletedAt", deleted) }

    private fun JsonElement.toSyncChange() = jsonObject.let { SyncChange(it["entity"]?.jsonPrimitive?.contentOrNull.orEmpty(), it["entityId"]?.jsonPrimitive?.contentOrNull.orEmpty(), it["rowVersion"]?.jsonPrimitive?.longOrNull ?: 1L, it["action"]?.jsonPrimitive?.contentOrNull ?: "upsert", it["row"]?.takeUnless { row -> row is JsonNull }) }
    private fun JsonObject.string(name: String) = this[name]?.jsonPrimitive?.contentOrNull ?: error("Missing $name")
    private fun JsonObject.stringOrNull(name: String) = this[name]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.long(name: String) = this[name]?.jsonPrimitive?.longOrNull ?: 0L
    private fun JsonObject.longOrNull(name: String) = this[name]?.jsonPrimitive?.longOrNull
    private fun JsonObject.bool(name: String) = this[name]?.jsonPrimitive?.booleanOrNull ?: false
    private fun jitter(base: Long) = Random.nextLong(0, (base / 10).coerceAtLeast(1))

    companion object { private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; isLenient = true } }
}

private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: String?) = put(key, value?.let(::JsonPrimitive) ?: JsonNull)
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Boolean) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Long) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Int) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Long?) = put(key, value?.let(::JsonPrimitive) ?: JsonNull)
private fun JsonArrayBuilder.add(value: String) = add(JsonPrimitive(value))
