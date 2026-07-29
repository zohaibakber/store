package com.example.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Mirrors the `batches` table in packages/db/src/shared/store.schema.ts —
 * stock for a product is tracked per batch so expiry (FEFO) can be honored,
 * same as the desktop invoicing flow.
 */
@Entity(
    tableName = "batches",
    foreignKeys = [
        ForeignKey(
            entity = Product::class,
            parentColumns = ["id"],
            childColumns = ["productId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("productId")],
)
data class Batch(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val productId: Int,
    val batchNumber: String? = null,
    val expiresAt: Long? = null,
    val packQuantity: Int = 0,
    val unitQuantity: Int = 0,
    val timestamp: Long = System.currentTimeMillis(),
)
