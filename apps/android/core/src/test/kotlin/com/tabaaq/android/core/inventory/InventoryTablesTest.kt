package com.tabaaq.android.core.inventory

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class InventoryTablesTest {
    @Test
    fun coversEverySyncedInventoryTable() {
        assertThat(InventoryTables.tables.keys).containsExactly(
            "categories",
            "products",
            "batches",
            "invoices",
            "invoice_items",
            "stock_movements",
        )
    }

    @Test
    fun neverDeclaresPowerSyncId() {
        InventoryTables.tables.forEach { (table, columns) ->
            assertThat(columns).doesNotContain("id")
            assertThat(InventoryTables.declaresId(table)).isFalse()
        }
    }

    @Test
    fun productColumnsMatchClientDb() {
        assertThat(InventoryTables.tables.getValue("products")).containsAtLeast(
            "name",
            "categoryId",
            "unitsPerPack",
            "visible",
            "organizationId",
            "rowVersion",
            "deletedAt",
        )
    }
}
