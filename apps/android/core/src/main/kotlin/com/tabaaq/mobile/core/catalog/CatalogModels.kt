package com.tabaaq.mobile.core.catalog

data class CatalogCategory(
    val id: String,
    val name: String,
    val tracksPacks: Boolean,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
)

data class CatalogBatch(
    val id: String,
    val productId: String,
    val batchNumber: String?,
    val expiresAt: Long?,
    val packQuantity: Long,
    val unitQuantity: Long,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
)

data class CatalogProduct(
    val id: String,
    val name: String,
    val categoryId: String,
    val category: String,
    val tracksPacks: Boolean,
    val composition: String?,
    val strength: String?,
    val details: String,
    val aisle: String?,
    val unitsPerPack: Long,
    val packPrice: Long?,
    val unitPrice: Long?,
    val visible: Boolean,
    val stock: Long,
    val stockLabel: String,
    val batches: List<CatalogBatch>,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
)

data class CatalogSnapshot(
    val products: List<CatalogProduct>,
    val categories: List<CatalogCategory>,
)

data class ProductRow(
    val id: String,
    val name: String,
    val categoryId: String,
    val aisle: String?,
    val composition: String?,
    val strength: String?,
    val unitsPerPack: Long,
    val packPrice: Long?,
    val unitPrice: Long?,
    val visible: Boolean,
    val organizationId: String,
    val createdByUserId: String,
    val updatedByUserId: String,
    val deviceId: String,
    val operationId: String,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)

data class CategoryRow(
    val id: String,
    val name: String,
    val tracksPacks: Boolean,
    val organizationId: String,
    val createdByUserId: String,
    val updatedByUserId: String,
    val deviceId: String,
    val operationId: String,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)

data class BatchRow(
    val id: String,
    val productId: String,
    val batchNumber: String?,
    val expiresAt: Long?,
    val packQuantity: Long,
    val unitQuantity: Long,
    val organizationId: String,
    val createdByUserId: String,
    val updatedByUserId: String,
    val deviceId: String,
    val operationId: String,
    val rowVersion: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long?,
)
