package com.example.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import net.sqlcipher.database.SupportFactory

/**
 * Version 2: switched Product/Batch to client-generated String ids and added
 * sync metadata + the pending_operations outbox (see AGENTS.md's "Data
 * model" section). Relies on `fallbackToDestructiveMigration()` — this local
 * DB has always been a scanning buffer, and real data now arrives from the
 * first sync pull rather than a bundled demo seed, so there's nothing worth
 * migrating in place.
 */
@Database(entities = [Product::class, Batch::class, PendingOperation::class], version = 2, exportSchema = false)
abstract class ProductDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao

    companion object {
        @Volatile
        private var INSTANCE: ProductDatabase? = null

        fun getDatabase(context: Context): ProductDatabase {
            return INSTANCE ?: synchronized(this) {
                val passphrase = "super_secret_secure_passphrase".toByteArray()
                val factory = SupportFactory(passphrase)

                Room.databaseBuilder(
                    context.applicationContext,
                    ProductDatabase::class.java,
                    "product_database.db",
                )
                    .openHelperFactory(factory)
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
