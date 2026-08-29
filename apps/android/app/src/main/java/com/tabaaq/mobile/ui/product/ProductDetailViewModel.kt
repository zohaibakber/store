package com.tabaaq.mobile.ui.product

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.core.catalog.CatalogProduct
import com.tabaaq.mobile.core.catalog.MutationIds
import com.tabaaq.mobile.core.catalog.SaveBatchDetailsInput
import com.tabaaq.mobile.core.catalog.UpdateBatchQuantityInput
import com.tabaaq.mobile.core.scan.ScanNormalize
import com.tabaaq.mobile.data.catalog.CatalogRepository
import com.tabaaq.mobile.data.powersync.PowerSyncSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ProductDetailUi(
    val product: CatalogProduct? = null,
    val error: String? = null,
    val notice: String? = null,
    val pending: Boolean = false,
    val quantityOpen: Boolean = false,
    val detailsOpen: Boolean = false,
    val selectedBatchId: String? = null,
    val packQuantity: String = "0",
    val unitQuantity: String = "0",
    val batchNumber: String = "",
    val expiresOn: String = "",
)

class ProductDetailViewModel(
    private val productId: String,
    private val catalog: CatalogRepository,
    powerSync: PowerSyncSession,
) : ViewModel() {
    private val error = MutableStateFlow<String?>(null)
    private val notice = MutableStateFlow<String?>(null)
    private val pending = MutableStateFlow(false)
    private val quantityOpen = MutableStateFlow(false)
    private val detailsOpen = MutableStateFlow(false)
    private val selectedBatchId = MutableStateFlow<String?>(null)
    private val packQuantity = MutableStateFlow("0")
    private val unitQuantity = MutableStateFlow("0")
    private val batchNumber = MutableStateFlow("")
    private val expiresOn = MutableStateFlow("")
    private val newBatchId = MutableStateFlow(MutationIds.rowId())

    val ui: StateFlow<ProductDetailUi> =
        combine(powerSync.snapshot, error, notice, pending) { snapshot, err, note, busy ->
            ProductDetailUi(
                product = snapshot.products.find { it.id == productId },
                error = err,
                notice = note,
                pending = busy,
                quantityOpen = quantityOpen.value,
                detailsOpen = detailsOpen.value,
                selectedBatchId = selectedBatchId.value,
                packQuantity = packQuantity.value,
                unitQuantity = unitQuantity.value,
                batchNumber = batchNumber.value,
                expiresOn = expiresOn.value,
            )
        }.combine(combine(quantityOpen, detailsOpen, selectedBatchId, packQuantity) { a, b, c, d -> listOf(a, b, c, d) }) { base, extra ->
            base.copy(
                quantityOpen = extra[0] as Boolean,
                detailsOpen = extra[1] as Boolean,
                selectedBatchId = extra[2] as String?,
                packQuantity = extra[3] as String,
            )
        }.combine(combine(unitQuantity, batchNumber, expiresOn) { u, n, e -> Triple(u, n, e) }) { base, rest ->
            base.copy(unitQuantity = rest.first, batchNumber = rest.second, expiresOn = rest.third)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductDetailUi())

    fun openQuantity(batchId: String?) {
        val product = ui.value.product
        val batch = product?.batches?.find { it.id == batchId }
        selectedBatchId.value = batchId
        if (batchId == null) newBatchId.value = MutationIds.rowId()
        packQuantity.value = (batch?.packQuantity ?: 0).toString()
        unitQuantity.value = (batch?.unitQuantity ?: 0).toString()
        batchNumber.value = batch?.batchNumber.orEmpty()
        expiresOn.value = ScanNormalize.expiryInputValue(batch?.expiresAt)
        error.value = null
        notice.value = null
        quantityOpen.value = true
    }

    fun openDetails(batchId: String?) {
        val product = ui.value.product
        val batch = product?.batches?.find { it.id == batchId }
        selectedBatchId.value = batchId
        if (batchId == null) newBatchId.value = MutationIds.rowId()
        batchNumber.value = batch?.batchNumber.orEmpty()
        expiresOn.value = ScanNormalize.expiryInputValue(batch?.expiresAt)
        error.value = null
        notice.value = null
        detailsOpen.value = true
    }

    fun closeSheets() {
        quantityOpen.value = false
        detailsOpen.value = false
    }

    fun setPackQuantity(value: String) {
        packQuantity.value = value
    }

    fun setUnitQuantity(value: String) {
        unitQuantity.value = value
    }

    fun setBatchNumber(value: String) {
        batchNumber.value = value
    }

    fun setExpiresOn(value: String) {
        expiresOn.value = value
    }

    fun confirmQuantity() {
        val product = ui.value.product ?: return
        viewModelScope.launch {
            pending.value = true
            error.value = null
            try {
                catalog.updateBatchQuantity(
                    UpdateBatchQuantityInput(
                        productId = product.id,
                        batchId = selectedBatchId.value,
                        newBatchId = newBatchId.value,
                        packQuantity =
                            if (product.tracksPacks) {
                                packQuantity.value.trim().toLongOrNull() ?: -1
                            } else {
                                0
                            },
                        unitQuantity = unitQuantity.value.trim().toLongOrNull() ?: -1,
                        batchNumber = batchNumber.value.ifBlank { null },
                        expiresAt = ScanNormalize.expiryTimestamp(expiresOn.value.ifBlank { null }),
                    ),
                )
                quantityOpen.value = false
                notice.value = "Quantity updated."
            } catch (cause: Exception) {
                error.value = cause.message ?: "Could not update quantity."
            } finally {
                pending.value = false
            }
        }
    }

    fun confirmDetails() {
        val product = ui.value.product ?: return
        val creating = selectedBatchId.value == null
        viewModelScope.launch {
            pending.value = true
            error.value = null
            try {
                val id =
                    catalog.saveBatchDetails(
                        SaveBatchDetailsInput(
                            productId = product.id,
                            batchId = selectedBatchId.value,
                            newBatchId = newBatchId.value,
                            batchNumber = batchNumber.value.ifBlank { null },
                            expiresAt = ScanNormalize.expiryTimestamp(expiresOn.value.ifBlank { null }),
                        ),
                    )
                detailsOpen.value = false
                notice.value = if (creating) "Batch created. Set the quantity next." else "Batch details saved."
                if (creating) openQuantity(id)
            } catch (cause: Exception) {
                error.value = cause.message ?: "Could not save the batch."
            } finally {
                pending.value = false
            }
        }
    }

    companion object {
        fun factory(
            productId: String,
            catalog: CatalogRepository,
            powerSync: PowerSyncSession,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ProductDetailViewModel(productId, catalog, powerSync) as T
        }
    }
}
