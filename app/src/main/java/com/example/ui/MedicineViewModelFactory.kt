package com.example.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.example.data.MedicineRepository
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService

class MedicineViewModelFactory(
    private val repository: MedicineRepository,
    private val textRecognitionService: TextRecognitionService,
    private val geminiParsingService: GeminiParsingService
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MedicineViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MedicineViewModel(repository, textRecognitionService, geminiParsingService) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
