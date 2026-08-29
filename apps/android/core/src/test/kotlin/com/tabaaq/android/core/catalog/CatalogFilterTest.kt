package com.tabaaq.android.core.catalog

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CatalogFilterTest {
    private val products =
        listOf(
            product("p1", "Amoxicillin", stock = 0, visible = true, category = "Antibiotic"),
            product("p2", "Paracetamol", stock = 4, visible = true, category = "Analgesic", aisle = "A2"),
            product("p3", "Hidden cream", stock = 20, visible = false, category = "Topical"),
            product("p4", "Vitamin D", stock = 40, visible = true, category = "Vitamin"),
        )

    @Test
    fun lowStockExcludesEmptyAndHealthy() {
        val filtered = CatalogFilter.filter(products, "", StockFilter.Low)
        assertThat(filtered.map { it.id }).containsExactly("p2")
    }

    @Test
    fun outOfStockOnly() {
        val filtered = CatalogFilter.filter(products, "", StockFilter.Out)
        assertThat(filtered.map { it.id }).containsExactly("p1")
    }

    @Test
    fun hiddenOnly() {
        val filtered = CatalogFilter.filter(products, "", StockFilter.Hidden)
        assertThat(filtered.map { it.id }).containsExactly("p3")
    }

    @Test
    fun queryPrefersPrefixMatches() {
        val extra = products + product("p5", "Paraffin", stock = 8, visible = true)
        val filtered = CatalogFilter.filter(extra, "para", StockFilter.All)
        assertThat(filtered.map { it.name }).containsExactly("Paracetamol", "Paraffin").inOrder()
    }

    @Test
    fun overviewCountsLowAndOut() {
        val overview = CatalogFilter.overview(products)
        assertThat(overview.count).isEqualTo(4)
        assertThat(overview.outOfStock).isEqualTo(1)
        assertThat(overview.lowStock).isEqualTo(1)
    }

    @Test
    fun needsAttentionSortsEmptyFirst() {
        val attention = CatalogFilter.needsAttention(products)
        assertThat(attention.map { it.id }).containsExactly("p1", "p2").inOrder()
    }

    private fun product(
        id: String,
        name: String,
        stock: Long,
        visible: Boolean,
        category: String = "General",
        aisle: String? = null,
    ) = CatalogProduct(
        id = id,
        name = name,
        categoryId = "cat",
        category = category,
        tracksPacks = true,
        composition = null,
        strength = null,
        details = "",
        aisle = aisle,
        unitsPerPack = 10,
        packPrice = null,
        unitPrice = 100,
        visible = visible,
        stock = stock,
        stockLabel = "$stock units",
        batches = emptyList(),
        rowVersion = 1,
        createdAt = 0,
        updatedAt = 0,
    )
}
