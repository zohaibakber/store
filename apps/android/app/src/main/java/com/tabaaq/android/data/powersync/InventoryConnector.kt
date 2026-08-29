package com.tabaaq.android.data.powersync

import com.powersync.PowerSyncDatabase
import com.powersync.connectors.PowerSyncBackendConnector
import com.powersync.connectors.PowerSyncCredentials
import com.powersync.db.crud.UpdateType
import com.tabaaq.android.core.inventory.InventoryHttp
import com.tabaaq.android.data.auth.AuthRepository
import com.tabaaq.android.data.network.HttpSupport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class InventoryConnector(
    private val http: HttpSupport,
    private val auth: AuthRepository,
) : PowerSyncBackendConnector() {
    override suspend fun fetchCredentials(): PowerSyncCredentials =
        withContext(Dispatchers.IO) {
            val token = auth.accessToken() ?: error("Sign in before connecting PowerSync.")
            val url = "${InventoryHttp.apiRoot(http.config.apiUrl)}/powersync/credentials"
            val response = http.execute(http.request(url, accessToken = token))
            val payload =
                http.decodeOrThrow(response, {
                    http.json.decodeFromString(JsonObject.serializer(), it)
                }, "PowerSync credentials failed.")
            val endpoint =
                payload["endpoint"]?.jsonPrimitive?.contentOrNull
                    ?: http.config.powerSyncUrlFallback.ifBlank { null }
                    ?: error("PowerSync credentials did not include an endpoint.")
            val syncToken = payload["token"]?.jsonPrimitive?.contentOrNull ?: error("PowerSync credentials did not include a token.")
            PowerSyncCredentials(endpoint = endpoint, token = syncToken)
        }

    override suspend fun uploadData(database: PowerSyncDatabase) {
        val transaction = database.getNextCrudTransaction() ?: return
        try {
            val token = auth.accessToken() ?: error("Sign in before uploading inventory.")
            for (entry in transaction.crud) {
                when (entry.table) {
                    "categories", "products", "batches" -> uploadCatalog(entry.table, entry.id, entry.op, entry.opData, token)
                    "invoices", "invoice_items", "stock_movements" -> {
                        // Invoice issue is a later slice. Leave the queue intact by retrying.
                        error("Invoice upload is not implemented in the first Android slice.")
                    }
                    else -> error("PowerSync queued an unsupported local write to ${entry.table}.")
                }
            }
            transaction.complete(null)
        } catch (error: Exception) {
            throw error
        }
    }

    private suspend fun uploadCatalog(
        table: String,
        id: String,
        op: UpdateType,
        opData: Map<String, String?>?,
        token: String,
    ) = withContext(Dispatchers.IO) {
        if (op == UpdateType.DELETE) {
            error("Use a soft delete for queued inventory row $table/$id.")
        }
        if (opData == null) error("PowerSync queued $table/$id without row data.")
        val entity =
            when (table) {
                "categories" -> "category"
                "products" -> "product"
                "batches" -> "batch"
                else -> error("Unsupported catalog table $table")
            }
        val row =
            buildJsonObject {
                put("id", id)
                for ((key, value) in opData) {
                    if (value == null) {
                        put(key, kotlinx.serialization.json.JsonNull)
                    } else {
                        put(key, value)
                    }
                }
            }
        val body =
            buildJsonObject {
                put("operationId", opData["operationId"] ?: id)
                put("organizationId", opData["organizationId"] ?: "")
                put("deviceId", opData["deviceId"] ?: "")
                put("actorUserId", opData["updatedByUserId"] ?: "")
                put("occurredAt", (opData["updatedAt"] ?: "0").toLongOrNull() ?: 0L)
                put("entity", entity)
                put("rows", kotlinx.serialization.json.buildJsonArray { add(row) })
            }
        val url = "${InventoryHttp.apiRoot(http.config.apiUrl)}/inventory/mutations"
        val response = http.execute(http.request(url, method = "POST", body = body.toString(), accessToken = token))
        if (!response.isSuccessful) {
            error("Inventory mutation failed (${response.code}).")
        }
    }
}
