package com.tabaaq.mobile.data.powersync

import com.powersync.db.schema.Column
import com.powersync.db.schema.Schema
import com.powersync.db.schema.Table
import com.powersync.db.schema.TrackPreviousValuesOptions

/**
 * Mirrors `inventoryPowerSyncSchema` in `@store/client-db`.
 * Do not declare `id`. PowerSync adds it.
 */
object InventorySchema {
    private val mutableColumns =
        listOf(
            Column.text("organizationId"),
            Column.text("createdByUserId"),
            Column.text("updatedByUserId"),
            Column.text("deviceId"),
            Column.text("operationId"),
            Column.integer("rowVersion"),
            Column.integer("createdAt"),
            Column.integer("updatedAt"),
            Column.integer("deletedAt"),
        )

    private val previous = TrackPreviousValuesOptions()

    val schema =
        Schema(
            Table(
                name = "categories",
                columns =
                    listOf(
                        Column.text("name"),
                        Column.integer("tracksPacks"),
                    ) + mutableColumns,
                trackPreviousValues = previous,
            ),
            Table(
                name = "products",
                columns =
                    listOf(
                        Column.text("name"),
                        Column.text("categoryId"),
                        Column.text("aisle"),
                        Column.text("composition"),
                        Column.text("strength"),
                        Column.integer("unitsPerPack"),
                        Column.integer("purchasePrice"),
                        Column.integer("retailPrice"),
                        Column.integer("unitPrice"),
                        Column.integer("visible"),
                    ) + mutableColumns,
                trackPreviousValues = previous,
            ),
            Table(
                name = "batches",
                columns =
                    listOf(
                        Column.text("productId"),
                        Column.text("batchNumber"),
                        Column.integer("expiresAt"),
                        Column.integer("packQuantity"),
                        Column.integer("unitQuantity"),
                    ) + mutableColumns,
                trackPreviousValues = previous,
            ),
            Table(
                name = "invoices",
                columns =
                    listOf(
                        Column.integer("invoiceNumber"),
                        Column.text("customerName"),
                        Column.integer("total"),
                    ) + mutableColumns,
            ),
            Table(
                name = "invoice_items",
                columns =
                    listOf(
                        Column.text("invoiceId"),
                        Column.text("productId"),
                        Column.text("batchId"),
                        Column.text("productName"),
                        Column.text("batchNumber"),
                        Column.integer("quantity"),
                        Column.text("quantityType"),
                        Column.integer("baseUnitQuantity"),
                        Column.integer("salePrice"),
                    ) + mutableColumns,
            ),
            Table(
                name = "stock_movements",
                columns =
                    listOf(
                        Column.text("productId"),
                        Column.text("batchId"),
                        Column.text("invoiceId"),
                        Column.text("type"),
                        Column.integer("packDelta"),
                        Column.integer("unitDelta"),
                        Column.text("note"),
                        Column.text("organizationId"),
                        Column.text("actorUserId"),
                        Column.text("deviceId"),
                        Column.text("operationId"),
                        Column.integer("createdAt"),
                    ),
            ),
        )
}
