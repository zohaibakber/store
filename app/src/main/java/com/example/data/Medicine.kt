package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "medicines")
data class Medicine(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val composition: String,
    val batchNumber: String,
    val expiryDate: String,
    val category: String = "General",
    val quantity: Int = 1,
    val timestamp: Long = System.currentTimeMillis()
)
