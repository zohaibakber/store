package com.example.data

import androidx.room.Embedded
import androidx.room.Relation

data class ProductWithBatches(
    @Embedded val product: Product,
    @Relation(parentColumn = "id", entityColumn = "productId")
    val batches: List<Batch>,
) {
    /** Earliest-expiring batch first (FEFO), matching the desktop sale flow. */
    val earliestBatch: Batch?
        get() = batches.filter { it.expiresAt != null }.minByOrNull { it.expiresAt!! } ?: batches.firstOrNull()

    val totalUnitQuantity: Int
        get() = batches.sumOf { it.unitQuantity + it.packQuantity * product.unitsPerPack }
}
