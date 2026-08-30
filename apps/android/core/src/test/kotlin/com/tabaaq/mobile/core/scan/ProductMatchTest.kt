package com.tabaaq.mobile.core.scan

import com.google.common.truth.Truth.assertThat
import com.tabaaq.mobile.core.catalog.CatalogBatch
import com.tabaaq.mobile.core.catalog.CatalogProduct
import org.junit.Test

class ProductMatchTest {
    @Test
    fun matchesExactNameAndStrength() {
        val product = product("Amoxil", "Amoxicillin", "500mg", 10)
        val other = product("Panadol", "Paracetamol", "500mg", 10)
        val result =
            ProductScanResult(
                name = "Amoxil",
                composition = "Amoxicillin",
                strength = "500mg",
                unitsPerPack = 10,
                batchNumber = null,
                expiresAt = null,
                confidence = 0.9,
            )
        assertThat(ProductMatch.find(listOf(product, other), result, "Amoxil 500mg")).isEqualTo(product)
    }

    private fun product(
        name: String,
        composition: String,
        strength: String,
        units: Long,
    ) = CatalogProduct(
        id = name,
        name = name,
        categoryId = "c",
        category = "Tablets",
        tracksPacks = true,
        composition = composition,
        strength = strength,
        details = "$composition · $strength",
        aisle = null,
        unitsPerPack = units,
        purchasePrice = null,
        retailPrice = null,
        unitPrice = null,
        visible = true,
        stock = 0,
        stockLabel = "0 units",
        batches = emptyList<CatalogBatch>(),
        rowVersion = 1,
        createdAt = 1,
        updatedAt = 1,
    )
}
