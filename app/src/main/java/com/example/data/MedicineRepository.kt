package com.example.data

import kotlinx.coroutines.flow.Flow

class MedicineRepository(private val medicineDao: MedicineDao) {
    val allMedicines: Flow<List<Medicine>> = medicineDao.getAllMedicines()

    suspend fun insert(medicine: Medicine) {
        medicineDao.insertMedicine(medicine)
    }

    suspend fun deleteById(id: Int) {
        medicineDao.deleteMedicineById(id)
    }
}
