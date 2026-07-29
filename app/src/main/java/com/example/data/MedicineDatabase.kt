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

@Database(entities = [Medicine::class], version = 2, exportSchema = false)
abstract class MedicineDatabase : RoomDatabase() {
    abstract fun medicineDao(): MedicineDao

    companion object {
        @Volatile
        private var INSTANCE: MedicineDatabase? = null

        fun getDatabase(context: Context): MedicineDatabase {
            return INSTANCE ?: synchronized(this) {
                val passphrase = "super_secret_secure_passphrase".toByteArray()
                val factory = SupportFactory(passphrase)

                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    MedicineDatabase::class.java,
                    "medicine_database.db"
                )
                .openHelperFactory(factory)
                .fallbackToDestructiveMigration()
                .addCallback(MedicineDatabaseCallback())
                .build()
                INSTANCE = instance
                instance
            }
        }
    }

    private class MedicineDatabaseCallback : RoomDatabase.Callback() {
        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            INSTANCE?.let { database ->
                CoroutineScope(Dispatchers.IO).launch {
                    val dao = database.medicineDao()
                    val demoMedicines = listOf(
                        Medicine(name = "Amoxicillin", composition = "Amoxicillin Trihydrate 500mg", batchNumber = "AX-9283-L", expiryDate = "12/26", category = "Antibiotic", quantity = 50),
                        Medicine(name = "Paracetamol", composition = "Paracetamol 500mg", batchNumber = "PC-1234-A", expiryDate = "10/25", category = "Analgesic", quantity = 100),
                        Medicine(name = "Ibuprofen", composition = "Ibuprofen 400mg", batchNumber = "IB-5678-B", expiryDate = "08/25", category = "NSAID", quantity = 30),
                        Medicine(name = "Loratadine", composition = "Loratadine 10mg", batchNumber = "LR-9012-C", expiryDate = "11/27", category = "Antihistamine", quantity = 45),
                        Medicine(name = "Metformin", composition = "Metformin Hydrochloride 500mg", batchNumber = "MF-3456-D", expiryDate = "05/26", category = "Antidiabetic", quantity = 120),
                        Medicine(name = "Omeprazole", composition = "Omeprazole 20mg", batchNumber = "OM-7890-E", expiryDate = "09/25", category = "Antacid", quantity = 60),
                        Medicine(name = "Atorvastatin", composition = "Atorvastatin Calcium 10mg", batchNumber = "AT-2468-F", expiryDate = "03/26", category = "Statin", quantity = 90),
                        Medicine(name = "Amlodipine", composition = "Amlodipine Besylate 5mg", batchNumber = "AM-1357-G", expiryDate = "07/27", category = "Antihypertensive", quantity = 80),
                        Medicine(name = "Azithromycin", composition = "Azithromycin 250mg", batchNumber = "AZ-3692-H", expiryDate = "02/25", category = "Antibiotic", quantity = 25),
                        Medicine(name = "Salbutamol", composition = "Salbutamol Sulfate 100mcg", batchNumber = "SL-8520-I", expiryDate = "04/26", category = "Bronchodilator", quantity = 15)
                    )
                    demoMedicines.forEach { dao.insertMedicine(it) }
                }
            }
        }
    }
}
