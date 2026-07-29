package com.example.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/**
 * Abstract class rather than an interface — Room only allows a `@Transaction`
 * method to have a concrete body (calling other DAO methods) that way, which
 * is what compound writes like [insertProductAndOutbox] need.
 */
@Dao
abstract class ProductDao {
    @Transaction
    @Query("SELECT * FROM products WHERE deletedAt IS NULL ORDER BY updatedAt DESC")
    abstract fun getAllProductsWithBatches(): Flow<List<ProductWithBatches>>

    @Query("SELECT * FROM products WHERE id = :id")
    abstract suspend fun getProductById(id: String): Product?

    @Query("SELECT * FROM batches WHERE id = :id")
    abstract suspend fun getBatchById(id: String): Batch?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertProductRow(product: Product)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertBatchRow(batch: Batch)

    @Query("UPDATE products SET deletedAt = :deletedAt, updatedAt = :deletedAt, rowVersion = rowVersion + 1 WHERE id = :id")
    abstract suspend fun softDeleteProductRow(id: String, deletedAt: Long)

    @Query("UPDATE batches SET deletedAt = :deletedAt, updatedAt = :deletedAt, rowVersion = rowVersion + 1 WHERE id = :id")
    abstract suspend fun softDeleteBatchRow(id: String, deletedAt: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertPendingOperation(operation: PendingOperation)

    @Query("SELECT * FROM pending_operations ORDER BY clientSequence ASC")
    abstract suspend fun getPendingOperations(): List<PendingOperation>

    @Query("DELETE FROM pending_operations WHERE operationId IN (:operationIds)")
    abstract suspend fun deletePendingOperations(operationIds: List<String>)

    @Transaction
    open suspend fun insertProductAndOutbox(product: Product, batch: Batch, operation: PendingOperation) {
        upsertProductRow(product)
        upsertBatchRow(batch)
        insertPendingOperation(operation)
    }

    @Transaction
    open suspend fun softDeleteProductAndOutbox(id: String, deletedAt: Long, operation: PendingOperation) {
        softDeleteProductRow(id, deletedAt)
        insertPendingOperation(operation)
    }
}
