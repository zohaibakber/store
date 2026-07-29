package com.example.sync

import com.example.data.Batch
import com.example.data.Product
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Wire shapes for the `row` field of a `SyncEntityChange`, matching
 * `syncEntityPushRows` in packages/contracts/src/sync/entity-rows.ts exactly:
 * server-owned columns (organizationId, deviceId, operationId, rowVersion,
 * updatedAt, deletedAt, createdBy/updatedByUserId) are omitted — the server
 * computes those itself (`serverOwnedColumns` in
 * apps/server/src/sync/row-validation.ts) — only `id` and optionally
 * `createdAt` are added back on top of the entity's own business columns.
 */
@Serializable
private data class ProductPushRow(
    val id: String,
    val name: String,
    val categoryId: String,
    val aisle: String? = null,
    val composition: String? = null,
    val strength: String? = null,
    val unitsPerPack: Int,
    val packPrice: Int? = null,
    val unitPrice: Int? = null,
    val visible: Boolean = true,
    val createdAt: Long? = null,
)

@Serializable
private data class BatchPushRow(
    val id: String,
    val productId: String,
    val batchNumber: String? = null,
    val expiresAt: Long? = null,
    val packQuantity: Int,
    val unitQuantity: Int,
    val createdAt: Long? = null,
)

@Serializable
private data class CategoryPushRow(
    val id: String,
    val name: String,
    val createdAt: Long? = null,
)

/**
 * The server's `categoryId` is a foreign key into a per-organization
 * `categories` table (dynamic rows, not a fixed enum) — there's no seeding
 * guarantee that a "general" row already exists for a given org. Every
 * product-creating operation therefore also upserts this row alongside the
 * product/batch changes, so the FK target always exists. Android's own
 * free-text `Product.category` (medicine/cosmetics/general) is a local
 * grouping convenience only and is intentionally NOT sent as `categoryId` —
 * syncing Android's category taxonomy against the server's real categories
 * is a follow-up, not solved here.
 */
const val GENERAL_CATEGORY_ID = "general"

fun generalCategoryRowJson(now: Long): String =
    Json.encodeToString(CategoryPushRow(id = GENERAL_CATEGORY_ID, name = "General", createdAt = now))

fun Product.toPushRowJson(): String = Json.encodeToString(
    ProductPushRow(
        id = id,
        name = name,
        categoryId = GENERAL_CATEGORY_ID,
        composition = composition,
        strength = strength,
        unitsPerPack = unitsPerPack,
        packPrice = packPrice,
        unitPrice = unitPrice,
        createdAt = sync.createdAt,
    ),
)

fun Batch.toPushRowJson(): String = Json.encodeToString(
    BatchPushRow(
        id = id,
        productId = productId,
        batchNumber = batchNumber,
        expiresAt = expiresAt,
        packQuantity = packQuantity,
        unitQuantity = unitQuantity,
        createdAt = sync.createdAt,
    ),
)
