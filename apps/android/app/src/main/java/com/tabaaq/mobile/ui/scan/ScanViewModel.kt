package com.tabaaq.mobile.ui.scan

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.core.catalog.CatalogProduct
import com.tabaaq.mobile.core.scan.ProductMatch
import com.tabaaq.mobile.core.scan.ProductScanMode
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.data.firebase.FirebaseProductScan
import com.tabaaq.mobile.data.sync.CatalogSyncSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ScanUi(
    val busy: Boolean = false,
    val error: String? = null,
    val result: ProductScanResult? = null,
    val match: CatalogProduct? = null,
)

class ScanViewModel(
    private val scan: FirebaseProductScan,
    private val catalogSync: CatalogSyncSession,
) : ViewModel() {
    private val _ui = MutableStateFlow(ScanUi())
    val ui: StateFlow<ScanUi> = _ui

    fun capture(bitmap: Bitmap) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, error = null) }
            try {
                val result = scan.infer(bitmap, ProductScanMode.Product)
                val match = ProductMatch.find(catalogSync.snapshot.value.products, result, result.name.orEmpty())
                _ui.update { it.copy(busy = false, result = result, match = match) }
            } catch (cause: Exception) {
                _ui.update {
                    it.copy(
                        busy = false,
                        error = cause.message ?: "Firebase could not read this label. Try a closer photo.",
                    )
                }
            }
        }
    }

    fun clearResult() {
        _ui.update { it.copy(result = null, match = null, error = null) }
    }

    companion object {
        fun factory(
            scan: FirebaseProductScan,
            catalogSync: CatalogSyncSession,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ScanViewModel(scan, catalogSync) as T
        }
    }
}
