package com.example.ui

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.Batch
import com.example.data.ExpiryDate
import com.example.data.Product
import com.example.data.ProductRepository
import com.example.data.ProductWithBatches
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProductDraft(
    val product: Product,
    val batch: Batch,
)

data class ScannerUiState(
    val isScanning: Boolean = false,
    val isProcessing: Boolean = false,
    val pendingDraft: ProductDraft? = null,
    val error: String? = null,
)

class ProductViewModel(
    private val repository: ProductRepository,
    private val textRecognitionService: TextRecognitionService,
    private val geminiParsingService: GeminiParsingService,
) : ViewModel() {

    val allProducts: StateFlow<List<ProductWithBatches>> = repository.allProducts
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList(),
        )

    private val _uiState = MutableStateFlow(ScannerUiState())
    val uiState: StateFlow<ScannerUiState> = _uiState

    fun startScanning() {
        _uiState.update { it.copy(isScanning = true, pendingDraft = null, error = null) }
    }

    fun stopScanning() {
        _uiState.update { it.copy(isScanning = false) }
    }

    fun processImage(bitmap: Bitmap) {
        viewModelScope.launch {
            _uiState.update { it.copy(isScanning = false, isProcessing = true, error = null) }

            try {
                val rawText = textRecognitionService.extractText(bitmap)

                if (rawText.isBlank()) {
                    _uiState.update { it.copy(isProcessing = false, error = "No text found in image") }
                    return@launch
                }

                val parsed = geminiParsingService.parseProductInfo(rawText)

                if (parsed != null) {
                    val draft = ProductDraft(
                        product = Product(
                            name = parsed.name,
                            category = parsed.category,
                            composition = parsed.composition,
                            strength = parsed.strength,
                        ),
                        batch = Batch(
                            productId = 0,
                            batchNumber = parsed.batchNumber,
                            expiresAt = ExpiryDate.parse(parsed.expiryDate),
                            unitQuantity = parsed.unitQuantity,
                        ),
                    )
                    _uiState.update { it.copy(isProcessing = false, pendingDraft = draft) }
                } else {
                    _uiState.update {
                        it.copy(
                            isProcessing = false,
                            error = "Failed to parse product details. Please check your Gemini API Key in AI Studio secrets.",
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isProcessing = false, error = e.localizedMessage) }
            }
        }
    }

    fun showManualEntry() {
        _uiState.update {
            it.copy(
                isScanning = false,
                pendingDraft = ProductDraft(
                    product = Product(name = "", category = "general"),
                    batch = Batch(productId = 0, unitQuantity = 1),
                ),
            )
        }
    }

    fun saveDraft(draft: ProductDraft) {
        viewModelScope.launch {
            repository.insert(draft.product, draft.batch)
            _uiState.update { it.copy(pendingDraft = null) }
        }
    }

    fun cancelSave() {
        _uiState.update { it.copy(pendingDraft = null) }
    }

    fun deleteProduct(id: Int) {
        viewModelScope.launch {
            repository.deleteById(id)
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
