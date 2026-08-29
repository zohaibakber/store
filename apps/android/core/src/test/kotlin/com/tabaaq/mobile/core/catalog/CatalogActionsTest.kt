package com.tabaaq.mobile.core.catalog

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CatalogActionsTest {
    private val actor = CatalogActor("org", "user", "device")

    @Test
    fun createsGeneralCategoryWhenNoneExist() {
        val actions = CatalogActions(emptyList(), emptyList(), emptyList(), actor, ids = { "new-id" }, now = { 10 }, operationId = { "op" })
        val (category, product) =
            actions.prepareProduct(
                SaveProductInput(
                    productId = null,
                    newProductId = "prod",
                    name = "Amoxil",
                    categoryId = null,
                    aisle = null,
                    composition = null,
                    strength = null,
                    unitsPerPack = 10,
                    packPrice = 1000,
                    unitPrice = 100,
                ),
            )
        assertThat(category?.insert).isTrue()
        assertThat(category?.row?.name).isEqualTo("General")
        assertThat(product.insert).isTrue()
        assertThat(product.row.name).isEqualTo("Amoxil")
        assertThat(product.row.categoryId).isEqualTo(category?.row?.id)
    }

    @Test
    fun rejectsBlankName() {
        val actions = CatalogActions(emptyList(), emptyList(), emptyList(), actor)
        try {
            actions.prepareProduct(
                SaveProductInput(null, "p", "  ", null, null, null, null, 1, null, null),
            )
            error("expected failure")
        } catch (error: IllegalStateException) {
            assertThat(error.message).contains("Product name")
        }
    }
}
