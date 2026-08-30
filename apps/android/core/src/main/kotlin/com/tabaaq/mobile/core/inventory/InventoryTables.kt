package com.tabaaq.mobile.core.inventory

/** Column lists mirrored from `@store/client-db` `inventoryPowerSyncSchema`. */
object InventoryTables {
    val mutable =
        listOf(
            "organizationId",
            "createdByUserId",
            "updatedByUserId",
            "deviceId",
            "operationId",
            "rowVersion",
            "createdAt",
            "updatedAt",
            "deletedAt",
        )

    val tables =
        mapOf(
            "categories" to listOf("name", "tracksPacks") + mutable,
            "products" to
                listOf(
                    "name",
                    "categoryId",
                    "aisle",
                    "composition",
                    "strength",
                    "unitsPerPack",
                    "purchasePrice",
                    "retailPrice",
                    "unitPrice",
                    "visible",
                ) + mutable,
            "batches" to listOf("productId", "batchNumber", "expiresAt", "packQuantity", "unitQuantity") + mutable,
            "invoices" to listOf("invoiceNumber", "customerName", "total") + mutable,
            "invoice_items" to
                listOf(
                    "invoiceId",
                    "productId",
                    "batchId",
                    "productName",
                    "batchNumber",
                    "quantity",
                    "quantityType",
                    "baseUnitQuantity",
                    "salePrice",
                ) + mutable,
            "stock_movements" to
                listOf(
                    "productId",
                    "batchId",
                    "invoiceId",
                    "type",
                    "packDelta",
                    "unitDelta",
                    "note",
                    "organizationId",
                    "actorUserId",
                    "deviceId",
                    "operationId",
                    "createdAt",
                ),
        )

    /** PowerSync owns `id`. Declaring it in the Kotlin schema throws. */
    fun declaresId(table: String): Boolean = false
}
