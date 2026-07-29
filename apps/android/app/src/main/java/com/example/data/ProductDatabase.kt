package com.example.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import net.sqlcipher.database.SupportFactory

@Database(entities = [Product::class, Batch::class], version = 1, exportSchema = false)
abstract class ProductDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao

    companion object {
        @Volatile
        private var INSTANCE: ProductDatabase? = null

        fun getDatabase(context: Context): ProductDatabase {
            return INSTANCE ?: synchronized(this) {
                val passphrase = "super_secret_secure_passphrase".toByteArray()
                val factory = SupportFactory(passphrase)

                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    ProductDatabase::class.java,
                    "product_database.db",
                )
                    .openHelperFactory(factory)
                    .fallbackToDestructiveMigration()
                    .addCallback(ProductDatabaseCallback())
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }

    private class ProductDatabaseCallback : RoomDatabase.Callback() {
        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            INSTANCE?.let { database ->
                CoroutineScope(Dispatchers.IO).launch {
                    val dao = database.productDao()
                    val demoProducts = listOf(
                        Product(name = "Amoxicillin", category = "medicine", composition = "Amoxicillin Trihydrate", strength = "500mg") to
                            Batch(productId = 0, batchNumber = "AX-9283-L", expiresAt = ExpiryDate.parse("12/26"), unitQuantity = 50),
                        Product(name = "Paracetamol", category = "medicine", composition = "Paracetamol", strength = "500mg") to
                            Batch(productId = 0, batchNumber = "PC-1234-A", expiresAt = ExpiryDate.parse("10/25"), unitQuantity = 100),
                        Product(name = "Ibuprofen", category = "medicine", composition = "Ibuprofen", strength = "400mg") to
                            Batch(productId = 0, batchNumber = "IB-5678-B", expiresAt = ExpiryDate.parse("08/25"), unitQuantity = 30),
                        Product(name = "Loratadine", category = "medicine", composition = "Loratadine", strength = "10mg") to
                            Batch(productId = 0, batchNumber = "LR-9012-C", expiresAt = ExpiryDate.parse("11/27"), unitQuantity = 45),
                        Product(name = "Metformin", category = "medicine", composition = "Metformin Hydrochloride", strength = "500mg") to
                            Batch(productId = 0, batchNumber = "MF-3456-D", expiresAt = ExpiryDate.parse("05/26"), unitQuantity = 120),
                    )
                    demoProducts.forEach { (product, batch) ->
                        val productId = dao.insertProduct(product)
                        dao.insertBatch(batch.copy(productId = productId.toInt()))
                    }
                }
            }
        }
    }
}
