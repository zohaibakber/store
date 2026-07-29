package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Mirrors the `products` table in packages/db/src/shared/store.schema.ts on
 * the desktop app, minus the multi-tenant/sync columns — this local Room
 * table is a scanning buffer, not yet wired into the sync pipeline.
 */
@Entity(tableName = "products")
data class Product(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val category: String = "general", // medicine | cosmetics | general
    val composition: String? = null,
    val strength: String? = null,
    val unitsPerPack: Int = 1,
    val packPrice: Int? = null,
    val unitPrice: Int? = null,
    val timestamp: Long = System.currentTimeMillis(),
)
