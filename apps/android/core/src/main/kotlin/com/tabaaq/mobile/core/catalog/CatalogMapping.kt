package com.tabaaq.mobile.core.catalog

object CatalogMapping {
    fun snapshotFromRows(
        products: List<ProductRow>,
        categories: List<CategoryRow>,
        batches: List<BatchRow>,
    ): CatalogSnapshot {
        val categoriesById = categories.associateBy { it.id }
        val mappedCategories =
            categories
                .map { category ->
                    CatalogCategory(
                        id = category.id,
                        name = category.name,
                        tracksPacks = category.tracksPacks,
                        rowVersion = category.rowVersion,
                        createdAt = category.createdAt,
                        updatedAt = category.updatedAt,
                    )
                }.sortedBy { it.name.lowercase() }

        val batchesByProduct = linkedMapOf<String, MutableList<CatalogBatch>>()
        for (batch in batches) {
            batchesByProduct.getOrPut(batch.productId) { mutableListOf() }.add(toCatalogBatch(batch))
        }
        for (list in batchesByProduct.values) {
            list.sortWith(
                compareBy<CatalogBatch> { it.expiresAt ?: Long.MAX_VALUE }.thenBy { it.createdAt },
            )
        }

        val mappedProducts =
            products
                .map { product ->
                    val category = categoriesById[product.categoryId]
                    val productBatches = batchesByProduct[product.id].orEmpty()
                    val stock =
                        productBatches.sumOf { batch ->
                            batch.packQuantity * product.unitsPerPack + batch.unitQuantity
                        }
                    CatalogProduct(
                        id = product.id,
                        name = product.name,
                        categoryId = product.categoryId,
                        category = category?.name ?: "Uncategorized",
                        tracksPacks = category?.tracksPacks ?: true,
                        composition = product.composition,
                        strength = product.strength,
                        details = listOfNotNull(product.composition, product.strength).joinToString(" · "),
                        aisle = product.aisle,
                        unitsPerPack = product.unitsPerPack,
                        purchasePrice = product.purchasePrice,
                        retailPrice = product.retailPrice,
                        unitPrice = product.unitPrice,
                        visible = product.visible,
                        stock = stock,
                        stockLabel = if (stock == 1L) "1 unit" else "$stock units",
                        batches = productBatches,
                        rowVersion = product.rowVersion,
                        createdAt = product.createdAt,
                        updatedAt = product.updatedAt,
                    )
                }.sortedBy { it.name.lowercase() }

        return CatalogSnapshot(
            products = mappedProducts,
            categories = mappedCategories,
            productRows = products,
            categoryRows = categories,
            batchRows = batches,
        )
    }

    private fun toCatalogBatch(batch: BatchRow) =
        CatalogBatch(
            id = batch.id,
            productId = batch.productId,
            batchNumber = batch.batchNumber,
            expiresAt = batch.expiresAt,
            packQuantity = batch.packQuantity,
            unitQuantity = batch.unitQuantity,
            rowVersion = batch.rowVersion,
            createdAt = batch.createdAt,
            updatedAt = batch.updatedAt,
        )
}
