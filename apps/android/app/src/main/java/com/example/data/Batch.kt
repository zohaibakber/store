package com.example.data

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * Mirrors the `batches` table in packages/db/src/shared/store.schema.ts —
 * stock for a product is tracked per batch so expiry (FEFO) can be honored,
 * same as the desktop invoicing flow. `id`/`productId` are client-generated
 * UUIDs, same reasoning as [Product.id].
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
    @PrimaryKey val id: String,
    val productId: String,
    val batchNumber: String? = null,
    val expiresAt: Long? = null,
    val packQuantity: Int = 0,
    val unitQuantity: Int = 0,
    @Embedded val sync: SyncMetadata = SyncMetadata(),
) {
    companion object {
        fun draft(
            productId: String,
            batchNumber: String? = null,
            expiresAt: Long? = null,
            unitQuantity: Int = 0,
            packQuantity: Int = 0,
        ) = Batch(
            id = UUID.randomUUID().toString(),
            productId = productId,
            batchNumber = batchNumber,
            expiresAt = expiresAt,
            unitQuantity = unitQuantity,
            packQuantity = packQuantity,
        )
    }
}
