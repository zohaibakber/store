package com.tabaaq.android.core.catalog

enum class StockFilter {
    All,
    Low,
    Out,
    Hidden,
}

data class InventoryOverview(
    val count: Int,
    val outOfStock: Int,
    val lowStock: Int,
    val stockValue: Long,
)

object CatalogFilter {
    const val LOW_STOCK_THRESHOLD = 10L

    fun filter(
        products: List<CatalogProduct>,
        query: String,
        filter: StockFilter,
    ): List<CatalogProduct> {
        val term = query.trim().lowercase()
        return products
            .filter { product ->
                when (filter) {
                    StockFilter.Low -> product.stock != 0L && product.stock <= LOW_STOCK_THRESHOLD
                    StockFilter.Out -> product.stock == 0L
                    StockFilter.Hidden -> !product.visible
                    StockFilter.All -> true
                } && matchesQuery(product, term)
            }.sortedWith(catalogOrder(term))
    }

    fun needsAttention(
        products: List<CatalogProduct>,
        limit: Int = 4,
    ): List<CatalogProduct> =
        products
            .filter { it.stock <= LOW_STOCK_THRESHOLD }
            .sortedBy { it.stock }
            .take(limit)

    fun overview(products: List<CatalogProduct>): InventoryOverview {
        var outOfStock = 0
        var lowStock = 0
        var stockValue = 0L
        for (product in products) {
            if (product.stock == 0L) {
                outOfStock += 1
            } else if (product.stock <= LOW_STOCK_THRESHOLD) {
                lowStock += 1
            }
            stockValue += product.stock * (product.unitPrice ?: 0L)
        }
        return InventoryOverview(
            count = products.size,
            outOfStock = outOfStock,
            lowStock = lowStock,
            stockValue = stockValue,
        )
    }

    private fun matchesQuery(
        product: CatalogProduct,
        term: String,
    ): Boolean {
        if (term.isEmpty()) return true
        val haystacks =
            buildList {
                add(product.name)
                add(product.category)
                add(product.details)
                product.aisle?.let(::add)
                product.batches.mapNotNullTo(this) { it.batchNumber }
            }
        return haystacks.any { it.lowercase().contains(term) }
    }

    private fun catalogOrder(term: String): Comparator<CatalogProduct> {
        if (term.isEmpty()) return compareBy { it.name.lowercase() }
        return compareByDescending<CatalogProduct> { it.name.lowercase().startsWith(term) }
            .thenBy { it.name.lowercase() }
    }
}
