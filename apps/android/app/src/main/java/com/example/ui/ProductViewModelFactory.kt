package com.example.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.example.data.ProductRepository
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService

class ProductViewModelFactory(
    private val repository: ProductRepository,
    private val textRecognitionService: TextRecognitionService,
    private val geminiParsingService: GeminiParsingService,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ProductViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return ProductViewModel(repository, textRecognitionService, geminiParsingService) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
