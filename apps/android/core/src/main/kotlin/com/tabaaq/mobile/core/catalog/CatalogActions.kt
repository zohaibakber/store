package com.tabaaq.mobile.core.catalog

data class SaveProductInput(
    val productId: String?,
    val newProductId: String,
    val name: String,
    val categoryId: String?,
    val aisle: String?,
    val composition: String?,
    val strength: String?,
    val unitsPerPack: Long?,
    val purchasePrice: Long?,
    val retailPrice: Long?,
    val unitPrice: Long?,
    val visible: Boolean? = null,
)

data class SaveBatchDetailsInput(
    val productId: String,
    val batchId: String?,
    val newBatchId: String,
    val batchNumber: String?,
    val expiresAt: Long?,
)

data class UpdateBatchQuantityInput(
    val productId: String,
    val batchId: String?,
    val newBatchId: String,
    val packQuantity: Long,
    val unitQuantity: Long,
    val batchNumber: String? = null,
    val expiresAt: Long? = null,
)

data class PreparedCategory(
    val row: CategoryRow,
    val insert: Boolean,
)

data class PreparedProduct(
    val row: ProductRow,
    val insert: Boolean,
)

data class PreparedBatch(
    val row: BatchRow,
    val insert: Boolean,
)

class CatalogActions(
    private val products: List<ProductRow>,
    private val categories: List<CategoryRow>,
    private val batches: List<BatchRow>,
    private val actor: CatalogActor,
    private val ids: () -> String = { MutationIds.rowId() },
    private val now: () -> Long = { MutationIds.now() },
    private val operationId: () -> String = { MutationIds.operationId() },
) {
    fun prepareProduct(input: SaveProductInput): Pair<PreparedCategory?, PreparedProduct> {
        val current = input.productId?.let { id -> products.find { it.id == id && it.deletedAt == null } }
        if (input.productId != null && current == null) {
            error("The product no longer exists. Refresh and try again.")
        }
        var categoryId = input.categoryId?.trim()?.takeIf { it.isNotEmpty() } ?: current?.categoryId
        var createdCategory: PreparedCategory? = null
        if (categoryId.isNullOrBlank() && categories.none { it.deletedAt == null }) {
            val created = createdMetadata(actor, now(), operationId())
            val row =
                CategoryRow(
                    id = ids(),
                    name = "General",
                    tracksPacks = true,
                    organizationId = actor.organizationId,
                    createdByUserId = actor.userId,
                    updatedByUserId = actor.userId,
                    deviceId = actor.deviceId,
                    operationId = created.operationId,
                    rowVersion = created.rowVersion,
                    createdAt = created.createdAt ?: now(),
                    updatedAt = created.updatedAt,
                    deletedAt = null,
                )
            createdCategory = PreparedCategory(row, insert = true)
            categoryId = row.id
        }
        val category =
            createdCategory?.row
                ?: categories.find { it.id == categoryId && it.deletedAt == null }
                ?: error("Choose a category for this product.")
        val unitsPerPack =
            if (category.tracksPacks) {
                CatalogValidation.nonNegativeInteger(input.unitsPerPack ?: current?.unitsPerPack ?: 1, "Units per pack")
            } else {
                1L
            }
        if (unitsPerPack < 1) error("Units per pack must be at least 1.")
        val values =
            ProductRow(
                id = input.productId ?: input.newProductId,
                name = CatalogValidation.requiredName(input.name),
                categoryId = category.id,
                aisle =
                    CatalogValidation.optionalText(
                        if (input.aisle == null && current != null) current.aisle else input.aisle,
                        64,
                        "Aisle",
                    ),
                composition =
                    CatalogValidation.optionalText(
                        if (input.composition == null && current != null) current.composition else input.composition,
                        160,
                        "Composition",
                    ),
                strength =
                    CatalogValidation.optionalText(
                        if (input.strength == null && current != null) current.strength else input.strength,
                        20,
                        "Strength",
                    ),
                unitsPerPack = unitsPerPack,
                purchasePrice = input.purchasePrice ?: current?.purchasePrice,
                retailPrice = if (category.tracksPacks) input.retailPrice ?: current?.retailPrice else null,
                unitPrice = input.unitPrice ?: current?.unitPrice,
                visible = input.visible ?: current?.visible ?: true,
                organizationId = current?.organizationId ?: actor.organizationId,
                createdByUserId = current?.createdByUserId ?: actor.userId,
                updatedByUserId = actor.userId,
                deviceId = actor.deviceId,
                operationId = operationId(),
                rowVersion = if (current == null) 1 else current.rowVersion + 1,
                createdAt = current?.createdAt ?: now(),
                updatedAt = now(),
                deletedAt = null,
            )
        return createdCategory to PreparedProduct(values, insert = current == null)
    }

    fun prepareBatchDetails(input: SaveBatchDetailsInput): PreparedBatch {
        val product = products.find { it.id == input.productId && it.deletedAt == null } ?: error("The product no longer exists. Refresh and try again.")
        val current = input.batchId?.let { id -> batches.find { it.id == id && it.deletedAt == null && it.productId == input.productId } }
        if (input.batchId != null && current == null) {
            error("The batch no longer exists for this product. Refresh and try again.")
        }
        val row =
            BatchRow(
                id = input.batchId ?: input.newBatchId,
                productId = product.id,
                batchNumber = CatalogValidation.optionalText(input.batchNumber, 64, "Batch number"),
                expiresAt = CatalogValidation.expiryTimestamp(input.expiresAt),
                packQuantity = current?.packQuantity ?: 0,
                unitQuantity = current?.unitQuantity ?: 0,
                organizationId = current?.organizationId ?: actor.organizationId,
                createdByUserId = current?.createdByUserId ?: actor.userId,
                updatedByUserId = actor.userId,
                deviceId = actor.deviceId,
                operationId = operationId(),
                rowVersion = if (current == null) 1 else current.rowVersion + 1,
                createdAt = current?.createdAt ?: now(),
                updatedAt = now(),
                deletedAt = null,
            )
        return PreparedBatch(row, insert = current == null)
    }

    fun prepareQuantity(input: UpdateBatchQuantityInput): PreparedBatch {
        val product = products.find { it.id == input.productId && it.deletedAt == null } ?: error("The product no longer exists. Refresh and try again.")
        val category = categories.find { it.id == product.categoryId && it.deletedAt == null }
        val current = input.batchId?.let { id -> batches.find { it.id == id && it.deletedAt == null && it.productId == input.productId } }
        if (input.batchId != null && current == null) {
            error("The batch no longer exists for this product. Refresh and try again.")
        }
        val requestedPacks = CatalogValidation.nonNegativeInteger(input.packQuantity, "Pack quantity")
        val unitQuantity = CatalogValidation.nonNegativeInteger(input.unitQuantity, "Unit quantity")
        if (category?.tracksPacks == false && current == null && requestedPacks != 0L) {
            error("This category tracks individual units, not packs.")
        }
        val packQuantity = if (category?.tracksPacks == false) current?.packQuantity ?: 0 else requestedPacks
        if (current == null && packQuantity + unitQuantity < 1) {
            error("Add at least one pack or unit when creating stock.")
        }
        val row =
            BatchRow(
                id = input.batchId ?: input.newBatchId,
                productId = product.id,
                batchNumber =
                    CatalogValidation.optionalText(
                        input.batchNumber ?: current?.batchNumber,
                        64,
                        "Batch number",
                    ),
                expiresAt = CatalogValidation.expiryTimestamp(input.expiresAt ?: current?.expiresAt),
                packQuantity = packQuantity,
                unitQuantity = unitQuantity,
                organizationId = current?.organizationId ?: actor.organizationId,
                createdByUserId = current?.createdByUserId ?: actor.userId,
                updatedByUserId = actor.userId,
                deviceId = actor.deviceId,
                operationId = operationId(),
                rowVersion = if (current == null) 1 else current.rowVersion + 1,
                createdAt = current?.createdAt ?: now(),
                updatedAt = now(),
                deletedAt = null,
            )
        return PreparedBatch(row, insert = current == null)
    }
}
