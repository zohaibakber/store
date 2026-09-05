package com.tabaaq.mobile.data.catalog

import com.tabaaq.mobile.core.catalog.CatalogActions
import com.tabaaq.mobile.core.catalog.SaveBatchDetailsInput
import com.tabaaq.mobile.core.catalog.SaveProductInput
import com.tabaaq.mobile.core.catalog.UpdateBatchQuantityInput
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.sync.CatalogSyncSession

class CatalogRepository(
    private val auth: AuthRepository,
    private val catalogSync: CatalogSyncSession,
) {
    suspend fun saveProduct(input: SaveProductInput): String {
        val (category, product) = actions().prepareProduct(input)
        if (category != null && category.insert) {
            catalogSync.persistCategory(category.row)
        }
        catalogSync.persistProduct(product.row, product.insert)
        return product.row.id
    }

    suspend fun saveBatchDetails(input: SaveBatchDetailsInput): String {
        val prepared = actions().prepareBatchDetails(input)
        catalogSync.persistBatch(prepared.row, prepared.insert)
        return prepared.row.id
    }

    suspend fun updateBatchQuantity(input: UpdateBatchQuantityInput): String {
        val prepared = actions().prepareQuantity(input)
        catalogSync.persistBatch(prepared.row, prepared.insert)
        return prepared.row.id
    }

    private fun actions(): CatalogActions {
        val actor = auth.currentActor() ?: error("Sign in and join a store before editing inventory.")
        val snapshot = catalogSync.snapshot.value
        return CatalogActions(snapshot.productRows, snapshot.categoryRows, snapshot.batchRows, actor)
    }
}
