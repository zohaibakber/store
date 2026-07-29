package com.example.ui

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.example.data.Batch
import com.example.data.ExpiryDate
import com.example.data.Product
import com.example.data.ProductRepository
import com.example.data.ProductWithBatches
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import com.example.sync.SyncWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProductDraft(
    val product: Product,
    val batch: Batch,
)

enum class SyncPhase { IDLE, SYNCING, ERROR }

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
    workManager: WorkManager,
) : ViewModel() {

    val allProducts: StateFlow<List<ProductWithBatches>> = repository.allProducts
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList(),
        )

    /** Reflects the background [SyncWorker]'s state — reused by both its periodic and expedited runs. */
    val syncPhase: StateFlow<SyncPhase> = combine(
        workManager.getWorkInfosForUniqueWorkFlow(SyncWorker.UNIQUE_PERIODIC_NAME),
        workManager.getWorkInfosForUniqueWorkFlow(SyncWorker.UNIQUE_EXPEDITED_NAME),
    ) { periodic, expedited ->
        val infos = periodic + expedited
        when {
            infos.any { it.state == WorkInfo.State.RUNNING } -> SyncPhase.SYNCING
            infos.any { it.state == WorkInfo.State.FAILED } -> SyncPhase.ERROR
            else -> SyncPhase.IDLE
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SyncPhase.IDLE)

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
                    val product = Product.draft(
                        name = parsed.name,
                        category = parsed.category,
                        composition = parsed.composition,
                        strength = parsed.strength,
                    )
                    val draft = ProductDraft(
                        product = product,
                        batch = Batch.draft(
                            productId = product.id,
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
        val product = Product.draft(name = "", category = "general")
        _uiState.update {
            it.copy(
                isScanning = false,
                pendingDraft = ProductDraft(
                    product = product,
                    batch = Batch.draft(productId = product.id, unitQuantity = 1),
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

    fun deleteProduct(id: String) {
        viewModelScope.launch {
            repository.deleteById(id)
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
