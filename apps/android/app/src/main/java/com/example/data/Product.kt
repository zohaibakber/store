package com.example.data

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * Mirrors the `products` table in packages/db/src/shared/store.schema.ts.
 * `id` is a client-generated UUID (not Room autoincrement) so it's a stable,
 * globally-unique row identity once synced — an autoincrementing local int
 * would collide across devices.
 */
@Entity(tableName = "products")
data class Product(
    @PrimaryKey val id: String,
    val name: String,
    val category: String = "general", // local grouping only — see sync/EntityRows.kt
    val composition: String? = null,
    val strength: String? = null,
    val unitsPerPack: Int = 1,
    val packPrice: Int? = null,
    val unitPrice: Int? = null,
    @Embedded val sync: SyncMetadata = SyncMetadata(),
) {
    companion object {
        /** A freshly-authored row; [com.example.data.ProductRepository.insert] fills in real sync metadata. */
        fun draft(
            name: String,
            category: String = "general",
            composition: String? = null,
            strength: String? = null,
        ) = Product(
            id = UUID.randomUUID().toString(),
            name = name,
            category = category,
            composition = composition,
            strength = strength,
        )
    }
}
