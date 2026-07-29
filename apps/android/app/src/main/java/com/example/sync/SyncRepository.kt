package com.example.sync

import com.example.auth.SessionStore
import com.example.data.Batch
import com.example.data.PendingOperation
import com.example.data.Product
import com.example.data.ProductDao
import com.example.data.SyncMetadata
import com.example.network.StoreApi
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

data class SyncOutcome(
    val pushed: Int,
    val pulled: Int,
)

/**
 * The client side of apps/server/src/routes/sync.ts: a single `POST
 * /api/sync` both pushes this device's outbox and pulls other devices'
 * changes since the stored cursor — there's no separate pull endpoint.
 */
class SyncRepository(
    private val storeApi: StoreApi,
    private val productDao: ProductDao,
    private val sessionStore: SessionStore,
) {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    suspend fun syncOnce(): Result<SyncOutcome> = runCatching {
        val organizationId = sessionStore.activeOrganizationIdFlow.first()
            ?: error("No active organization — sign in first")
        val deviceId = sessionStore.deviceId()
        val cursor = sessionStore.syncCursor()

        val pendingOperations = productDao.getPendingOperations()
        val operations = pendingOperations.map { it.toWireOperation() }

        val response = storeApi.sync(
            SyncRequest(
                organizationId = organizationId,
                deviceId = deviceId,
                cursor = cursor,
                operations = operations,
            ),
        )

        val acknowledgedIds = response.acknowledgements.map { it.operationId }
        if (acknowledgedIds.isNotEmpty()) {
            productDao.deletePendingOperations(acknowledgedIds)
        }

        response.changes.forEach { applyServerChange(it) }
        sessionStore.saveSyncCursor(response.cursor)

        SyncOutcome(pushed = acknowledgedIds.size, pulled = response.changes.size)
    }

    /** Builds the wire [SyncOperation], computing `payloadHash` per [CanonicalJson]. */
    private fun PendingOperation.toWireOperation(): SyncOperation {
        val changes = PendingOperation.decodeChanges(changesJson).map { change ->
            SyncEntityChange(
                entity = change.entity,
                action = change.action,
                entityId = change.entityId,
                rowVersion = change.rowVersion,
                row = lenientJson.parseToJsonElement(change.rowJson),
            )
        }
        val payload = SyncOperationPayload(
            operationId = operationId,
            organizationId = organizationId,
            deviceId = deviceId,
            actorUserId = actorUserId,
            clientSequence = clientSequence,
            occurredAt = occurredAt,
            changes = changes,
        )
        val hash = CanonicalJson.sha256Hex(
            CanonicalJson.stringify(lenientJson.encodeToJsonElement(payload)),
        )
        return SyncOperation(
            operationId = operationId,
            organizationId = organizationId,
            deviceId = deviceId,
            actorUserId = actorUserId,
            clientSequence = clientSequence,
            occurredAt = occurredAt,
            payloadHash = hash,
            changes = changes,
        )
    }

    private suspend fun applyServerChange(serverChange: SyncServerChange) {
        val change = serverChange.change
        when (change.entity) {
            "product" -> applyProductChange(change, serverChange.changedAt)
            "batch" -> applyBatchChange(change, serverChange.changedAt)
            // "category" / "invoice" / "invoiceItem" / "stockMovement": no local
            // table for these yet — acknowledged via the cursor advance above,
            // intentionally not applied anywhere.
        }
    }

    private suspend fun applyProductChange(change: SyncEntityChange, changedAt: Long) {
        val local = productDao.getProductById(change.entityId)
        if (local != null && local.sync.rowVersion >= change.rowVersion) return

        if (change.action == "delete") {
            productDao.softDeleteProductRow(change.entityId, deletedAt = changedAt)
            return
        }

        val row = lenientJson.decodeFromJsonElement<IncomingProductRow>(change.row)
        productDao.upsertProductRow(
            Product(
                id = row.id,
                name = row.name,
                category = local?.category ?: "general",
                composition = row.composition,
                strength = row.strength,
                unitsPerPack = row.unitsPerPack,
                packPrice = row.packPrice,
                unitPrice = row.unitPrice,
                sync = SyncMetadata(
                    rowVersion = change.rowVersion,
                    createdAt = row.createdAt ?: local?.sync?.createdAt ?: changedAt,
                    updatedAt = changedAt,
                ),
            ),
        )
    }

    private suspend fun applyBatchChange(change: SyncEntityChange, changedAt: Long) {
        val local = productDao.getBatchById(change.entityId)
        if (local != null && local.sync.rowVersion >= change.rowVersion) return

        if (change.action == "delete") {
            productDao.softDeleteBatchRow(change.entityId, deletedAt = changedAt)
            return
        }

        val row = lenientJson.decodeFromJsonElement<IncomingBatchRow>(change.row)
        productDao.upsertBatchRow(
            Batch(
                id = row.id,
                productId = row.productId,
                batchNumber = row.batchNumber,
                expiresAt = row.expiresAt,
                packQuantity = row.packQuantity,
                unitQuantity = row.unitQuantity,
                sync = SyncMetadata(
                    rowVersion = change.rowVersion,
                    createdAt = row.createdAt ?: local?.sync?.createdAt ?: changedAt,
                    updatedAt = changedAt,
                ),
            ),
        )
    }
}

@Serializable
private data class IncomingProductRow(
    val id: String,
    val name: String,
    val composition: String? = null,
    val strength: String? = null,
    val unitsPerPack: Int = 1,
    val packPrice: Int? = null,
    val unitPrice: Int? = null,
    val createdAt: Long? = null,
)

@Serializable
private data class IncomingBatchRow(
    val id: String,
    val productId: String,
    val batchNumber: String? = null,
    val expiresAt: Long? = null,
    val packQuantity: Int = 0,
    val unitQuantity: Int = 0,
    val createdAt: Long? = null,
)
