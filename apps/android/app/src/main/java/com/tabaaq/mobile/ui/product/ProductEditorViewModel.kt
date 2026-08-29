package com.tabaaq.mobile.ui.product

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.core.catalog.CatalogCategory
import com.tabaaq.mobile.core.catalog.CatalogValidation
import com.tabaaq.mobile.core.catalog.SaveProductInput
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.data.catalog.CatalogRepository
import com.tabaaq.mobile.data.powersync.PowerSyncSession
import com.tabaaq.mobile.core.catalog.MutationIds
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ProductEditorUi(
    val name: String = "",
    val composition: String = "",
    val strength: String = "",
    val aisle: String = "",
    val unitsPerPack: String = "1",
    val packPrice: String = "",
    val unitPrice: String = "",
    val categoryId: String = "",
    val categories: List<CatalogCategory> = emptyList(),
    val saving: Boolean = false,
    val error: String? = null,
    val createdId: String? = null,
)

class ProductEditorViewModel(
    private val catalog: CatalogRepository,
    powerSync: PowerSyncSession,
    draft: ProductScanResult?,
) : ViewModel() {
    private val name = MutableStateFlow(draft?.name.orEmpty())
    private val composition = MutableStateFlow(draft?.composition.orEmpty())
    private val strength = MutableStateFlow(draft?.strength.orEmpty())
    private val aisle = MutableStateFlow("")
    private val unitsPerPack = MutableStateFlow(draft?.unitsPerPack?.toString() ?: "1")
    private val packPrice = MutableStateFlow("")
    private val unitPrice = MutableStateFlow("")
    private val categoryId = MutableStateFlow("")
    private val saving = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val createdId = MutableStateFlow<String?>(null)

    val ui: StateFlow<ProductEditorUi> =
        combine(
            combine(name, composition, strength, aisle) { n, c, s, a -> listOf(n, c, s, a) },
            combine(unitsPerPack, packPrice, unitPrice, categoryId) { u, p, up, cat -> listOf(u, p, up, cat) },
            combine(powerSync.snapshot, saving, error, createdId) { snap, sv, err, id -> Triple(snap, sv to err, id) },
        ) { text, prices, rest ->
            val snapshot = rest.first
            val (sv, err) = rest.second
            val selected = prices[3].ifBlank { snapshot.categories.firstOrNull()?.id.orEmpty() }
            ProductEditorUi(
                name = text[0],
                composition = text[1],
                strength = text[2],
                aisle = text[3],
                unitsPerPack = prices[0],
                packPrice = prices[1],
                unitPrice = prices[2],
                categoryId = selected,
                categories = snapshot.categories,
                saving = sv,
                error = err,
                createdId = rest.third,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductEditorUi())

    fun setName(value: String) {
        name.value = value
    }

    fun setComposition(value: String) {
        composition.value = value
    }

    fun setStrength(value: String) {
        strength.value = value
    }

    fun setAisle(value: String) {
        aisle.value = value
    }

    fun setUnitsPerPack(value: String) {
        unitsPerPack.value = value
    }

    fun setPackPrice(value: String) {
        packPrice.value = value
    }

    fun setUnitPrice(value: String) {
        unitPrice.value = value
    }

    fun setCategoryId(value: String) {
        categoryId.value = value
    }

    fun save() {
        viewModelScope.launch {
            val current = ui.value
            val tracksPacks = current.categories.find { it.id == current.categoryId }?.tracksPacks ?: true
            val units = current.unitsPerPack.trim().toLongOrNull()
            if (current.name.isBlank()) {
                error.value = "Enter a product name."
                return@launch
            }
            if (tracksPacks && (units == null || units < 1)) {
                error.value = "Units per pack must be a positive whole number."
                return@launch
            }
            val pack = CatalogValidation.priceInPaisa(current.packPrice)
            val unit = CatalogValidation.priceInPaisa(current.unitPrice)
            if ((current.packPrice.isNotBlank() && pack == null) || (current.unitPrice.isNotBlank() && unit == null)) {
                error.value = "Prices must be valid non-negative amounts."
                return@launch
            }
            saving.value = true
            error.value = null
            try {
                createdId.value =
                    catalog.saveProduct(
                        SaveProductInput(
                            productId = null,
                            newProductId = MutationIds.rowId(),
                            name = current.name,
                            categoryId = current.categoryId.ifBlank { null },
                            aisle = current.aisle.trim().ifBlank { null },
                            composition = current.composition.trim().ifBlank { null },
                            strength = current.strength.trim().ifBlank { null },
                            unitsPerPack = if (tracksPacks) units else 1,
                            packPrice = if (tracksPacks) pack else null,
                            unitPrice = unit,
                        ),
                    )
            } catch (cause: Exception) {
                error.value = cause.message ?: "Could not save the product."
            } finally {
                saving.value = false
            }
        }
    }

    companion object {
        fun factory(
            catalog: CatalogRepository,
            powerSync: PowerSyncSession,
            draft: ProductScanResult?,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ProductEditorViewModel(catalog, powerSync, draft) as T
        }
    }
}
