package com.tabaaq.mobile.data.catalog

import com.tabaaq.mobile.core.catalog.CatalogActions
import com.tabaaq.mobile.core.catalog.SaveBatchDetailsInput
import com.tabaaq.mobile.core.catalog.SaveProductInput
import com.tabaaq.mobile.core.catalog.UpdateBatchQuantityInput
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.powersync.PowerSyncSession

class CatalogRepository(
    private val auth: AuthRepository,
    private val powerSync: PowerSyncSession,
) {
    suspend fun saveProduct(input: SaveProductInput): String {
        val (category, product) = actions().prepareProduct(input)
        if (category != null && category.insert) {
            powerSync.persistCategory(category.row)
        }
        powerSync.persistProduct(product.row, product.insert)
        return product.row.id
    }

    suspend fun saveBatchDetails(input: SaveBatchDetailsInput): String {
        val prepared = actions().prepareBatchDetails(input)
        powerSync.persistBatch(prepared.row, prepared.insert)
        return prepared.row.id
    }

    suspend fun updateBatchQuantity(input: UpdateBatchQuantityInput): String {
        val prepared = actions().prepareQuantity(input)
        powerSync.persistBatch(prepared.row, prepared.insert)
        return prepared.row.id
    }

    private fun actions(): CatalogActions {
        val actor = auth.currentActor() ?: error("Sign in and join a store before editing inventory.")
        val snapshot = powerSync.snapshot.value
        return CatalogActions(snapshot.productRows, snapshot.categoryRows, snapshot.batchRows, actor)
    }
}
