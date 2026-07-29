package com.example.data

import androidx.work.WorkManager
import com.example.auth.SessionStore
import com.example.sync.GENERAL_CATEGORY_ID
import com.example.sync.SyncWorker
import com.example.sync.generalCategoryRowJson
import com.example.sync.toPushRowJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import java.util.UUID

class ProductRepository(
    private val productDao: ProductDao,
    private val sessionStore: SessionStore,
    private val workManager: WorkManager,
) {
    val allProducts: Flow<List<ProductWithBatches>> = productDao.getAllProductsWithBatches()

    /** Writes the product/batch rows and queues one outbox operation, all in a single transaction. */
    suspend fun insert(productDraft: Product, batchDraft: Batch) {
        val organizationId = requireActiveOrganizationId()
        val deviceId = sessionStore.deviceId()
        val actorUserId = requireUserId()
        val now = System.currentTimeMillis()

        val product = productDraft.copy(sync = SyncMetadata(rowVersion = 1, createdAt = now, updatedAt = now))
        val batch = batchDraft.copy(sync = SyncMetadata(rowVersion = 1, createdAt = now, updatedAt = now))

        val operation = PendingOperation(
            operationId = UUID.randomUUID().toString(),
            organizationId = organizationId,
            deviceId = deviceId,
            actorUserId = actorUserId,
            clientSequence = sessionStore.nextClientSequence(),
            occurredAt = now,
            changesJson = PendingOperation.encodeChanges(
                listOf(
                    // Ensures the categoryId FK target exists — see sync/EntityRows.kt.
                    PendingChange(
                        entity = "category",
                        action = "upsert",
                        entityId = GENERAL_CATEGORY_ID,
                        rowVersion = 1,
                        rowJson = generalCategoryRowJson(now),
                    ),
                    PendingChange(
                        entity = "product",
                        action = "upsert",
                        entityId = product.id,
                        rowVersion = product.sync.rowVersion,
                        rowJson = product.toPushRowJson(),
                    ),
                    PendingChange(
                        entity = "batch",
                        action = "upsert",
                        entityId = batch.id,
                        rowVersion = batch.sync.rowVersion,
                        rowJson = batch.toPushRowJson(),
                    ),
                ),
            ),
        )

        productDao.insertProductAndOutbox(product, batch, operation)
        SyncWorker.syncNow(workManager)
    }

    suspend fun deleteById(id: String) {
        val organizationId = requireActiveOrganizationId()
        val deviceId = sessionStore.deviceId()
        val actorUserId = requireUserId()
        val now = System.currentTimeMillis()
        val current = productDao.getProductById(id)
        val nextRowVersion = (current?.sync?.rowVersion ?: 0) + 1

        val operation = PendingOperation(
            operationId = UUID.randomUUID().toString(),
            organizationId = organizationId,
            deviceId = deviceId,
            actorUserId = actorUserId,
            clientSequence = sessionStore.nextClientSequence(),
            occurredAt = now,
            changesJson = PendingOperation.encodeChanges(
                listOf(
                    PendingChange(
                        entity = "product",
                        action = "delete",
                        entityId = id,
                        rowVersion = nextRowVersion,
                        rowJson = current?.copy(sync = current.sync.copy(rowVersion = nextRowVersion))
                            ?.toPushRowJson() ?: "{}",
                    ),
                ),
            ),
        )

        productDao.softDeleteProductAndOutbox(id, now, operation)
        SyncWorker.syncNow(workManager)
    }

    private suspend fun requireActiveOrganizationId(): String =
        sessionStore.activeOrganizationIdFlow.first() ?: error("No active organization — sign in first")

    private suspend fun requireUserId(): String =
        sessionStore.userId() ?: error("No signed-in user")
}
