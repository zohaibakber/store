package com.tabaaq.mobile.core.catalog

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CatalogMappingTest {
    @Test
    fun stockSumsPacksAndLooseUnits() {
        val snapshot =
            CatalogMapping.snapshotFromRows(
                products =
                    listOf(
                        productRow(id = "prod", unitsPerPack = 10, categoryId = "cat"),
                    ),
                categories = listOf(categoryRow(id = "cat", name = "Tablets", tracksPacks = true)),
                batches =
                    listOf(
                        batchRow(id = "b1", productId = "prod", packQuantity = 2, unitQuantity = 3, expiresAt = 200),
                        batchRow(id = "b2", productId = "prod", packQuantity = 1, unitQuantity = 0, expiresAt = 100),
                    ),
            )

        val product = snapshot.products.single()
        assertThat(product.stock).isEqualTo(33)
        assertThat(product.stockLabel).isEqualTo("33 units")
        assertThat(product.category).isEqualTo("Tablets")
        assertThat(product.batches.map { it.id }).containsExactly("b2", "b1").inOrder()
    }

    @Test
    fun missingCategoryFallsBack() {
        val snapshot =
            CatalogMapping.snapshotFromRows(
                products = listOf(productRow(id = "prod", unitsPerPack = 1, categoryId = "missing")),
                categories = emptyList(),
                batches = emptyList(),
            )
        assertThat(snapshot.products.single().category).isEqualTo("Uncategorized")
        assertThat(snapshot.products.single().stockLabel).isEqualTo("0 units")
    }

    @Test
    fun detailsJoinCompositionAndStrength() {
        val snapshot =
            CatalogMapping.snapshotFromRows(
                products =
                    listOf(
                        productRow(
                            id = "prod",
                            unitsPerPack = 1,
                            categoryId = "cat",
                            composition = "Amoxicillin",
                            strength = "500 mg",
                        ),
                    ),
                categories = listOf(categoryRow(id = "cat", name = "Antibiotic")),
                batches = emptyList(),
            )
        assertThat(snapshot.products.single().details).isEqualTo("Amoxicillin · 500 mg")
    }

    private fun productRow(
        id: String,
        unitsPerPack: Long,
        categoryId: String,
        composition: String? = null,
        strength: String? = null,
    ) = ProductRow(
        id = id,
        name = "Item",
        categoryId = categoryId,
        aisle = null,
        composition = composition,
        strength = strength,
        unitsPerPack = unitsPerPack,
        purchasePrice = null,
        retailPrice = null,
        unitPrice = 2500,
        visible = true,
        organizationId = "org",
        createdByUserId = "user",
        updatedByUserId = "user",
        deviceId = "device",
        operationId = "op",
        rowVersion = 1,
        createdAt = 1,
        updatedAt = 1,
        deletedAt = null,
    )

    private fun categoryRow(
        id: String,
        name: String,
        tracksPacks: Boolean = true,
    ) = CategoryRow(
        id = id,
        name = name,
        tracksPacks = tracksPacks,
        organizationId = "org",
        createdByUserId = "user",
        updatedByUserId = "user",
        deviceId = "device",
        operationId = "op",
        rowVersion = 1,
        createdAt = 1,
        updatedAt = 1,
        deletedAt = null,
    )

    private fun batchRow(
        id: String,
        productId: String,
        packQuantity: Long,
        unitQuantity: Long,
        expiresAt: Long?,
    ) = BatchRow(
        id = id,
        productId = productId,
        batchNumber = id,
        expiresAt = expiresAt,
        packQuantity = packQuantity,
        unitQuantity = unitQuantity,
        organizationId = "org",
        createdByUserId = "user",
        updatedByUserId = "user",
        deviceId = "device",
        operationId = "op",
        rowVersion = 1,
        createdAt = 1,
        updatedAt = 1,
        deletedAt = null,
    )
}
