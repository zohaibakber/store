package com.example.ui

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.Medicine
import com.example.data.MedicineRepository
import com.example.ml.GeminiParsingService
import com.example.ml.TextRecognitionService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ScannerUiState(
    val isScanning: Boolean = false,
    val isProcessing: Boolean = false,
    val pendingMedicine: Medicine? = null,
    val error: String? = null
)

class MedicineViewModel(
    private val repository: MedicineRepository,
    private val textRecognitionService: TextRecognitionService,
    private val geminiParsingService: GeminiParsingService
) : ViewModel() {

    val allMedicines: StateFlow<List<Medicine>> = repository.allMedicines
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    private val _uiState = MutableStateFlow(ScannerUiState())
    val uiState: StateFlow<ScannerUiState> = _uiState

    fun startScanning() {
        _uiState.update { it.copy(isScanning = true, pendingMedicine = null, error = null) }
    }

    fun stopScanning() {
        _uiState.update { it.copy(isScanning = false) }
    }

    fun processImage(bitmap: Bitmap) {
        viewModelScope.launch {
            _uiState.update { it.copy(isScanning = false, isProcessing = true, error = null) }
            
            try {
                // 1. Extract text with ML Kit
                val rawText = textRecognitionService.extractText(bitmap)
                
                if (rawText.isBlank()) {
                    _uiState.update { it.copy(isProcessing = false, error = "No text found in image") }
                    return@launch
                }
                
                // 2. Parse text with Gemini
                val parsed = geminiParsingService.parseMedicineInfo(rawText)
                
                if (parsed != null) {
                    val medicine = Medicine(
                        name = parsed.name,
                        composition = parsed.composition,
                        batchNumber = parsed.batchNumber,
                        expiryDate = parsed.expiryDate,
                        category = parsed.category,
                        quantity = parsed.quantity
                    )
                    _uiState.update { it.copy(isProcessing = false, pendingMedicine = medicine) }
                } else {
                    _uiState.update { it.copy(isProcessing = false, error = "Failed to parse medicine details. Please check your Gemini API Key in AI Studio secrets.") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isProcessing = false, error = e.localizedMessage) }
            }
        }
    }

    fun showManualEntry() {
        _uiState.update { it.copy(
            isScanning = false, 
            pendingMedicine = Medicine(name = "", composition = "", batchNumber = "", expiryDate = "", category = "", quantity = 1)
        ) }
    }

    fun saveMedicine(medicine: Medicine) {
        viewModelScope.launch {
            repository.insert(medicine)
            _uiState.update { it.copy(pendingMedicine = null) }
        }
    }
    
    fun cancelSave() {
        _uiState.update { it.copy(pendingMedicine = null) }
    }

    fun deleteMedicine(id: Int) {
        viewModelScope.launch {
            repository.deleteById(id)
        }
    }
    
    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
