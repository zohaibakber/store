package com.example.data

import androidx.room.Embedded
import androidx.room.Relation

data class ProductWithBatches(
    @Embedded val product: Product,
    @Relation(parentColumn = "id", entityColumn = "productId")
    val batches: List<Batch>,
) {
    private val activeBatches: List<Batch>
        get() = batches.filter { it.sync.deletedAt == null }

    /** Earliest-expiring batch first (FEFO), matching the desktop sale flow. */
    val earliestBatch: Batch?
        get() = activeBatches.filter { it.expiresAt != null }.minByOrNull { it.expiresAt!! }
            ?: activeBatches.firstOrNull()

    val totalUnitQuantity: Int
        get() = activeBatches.sumOf { it.unitQuantity + it.packQuantity * product.unitsPerPack }
}
