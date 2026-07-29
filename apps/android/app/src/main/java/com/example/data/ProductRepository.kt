package com.example.data

import kotlinx.coroutines.flow.Flow

class ProductRepository(private val productDao: ProductDao) {
    val allProducts: Flow<List<ProductWithBatches>> = productDao.getAllProductsWithBatches()

    suspend fun insert(product: Product, batch: Batch) {
        val productId = productDao.insertProduct(product)
        productDao.insertBatch(batch.copy(productId = productId.toInt()))
    }

    suspend fun deleteById(id: Int) {
        productDao.deleteProductById(id)
    }
}
