package com.tabaaq.mobile.ui.product

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.core.catalog.CatalogCategory
import com.tabaaq.mobile.core.catalog.CatalogValidation
import com.tabaaq.mobile.core.catalog.SaveProductInput
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.data.catalog.CatalogRepository
import com.tabaaq.mobile.data.sync.CatalogSyncSession
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
    val strengthUnit: String = "mg",
    val aisle: String = "",
    val unitsPerPack: String = "",
    val purchasePrice: String = "",
    val retailPrice: String = "",
    val unitPrice: String = "",
    val categoryId: String = "",
    val categories: List<CatalogCategory> = emptyList(),
    val tracksPacks: Boolean = true,
    val saving: Boolean = false,
    val error: String? = null,
    val createdId: String? = null,
)

class ProductEditorViewModel(
    private val catalog: CatalogRepository,
    catalogSync: CatalogSyncSession,
    draft: ProductScanResult?,
) : ViewModel() {
    private val parsedStrength = parseStrength(draft?.strength)
    private val name = MutableStateFlow(draft?.name.orEmpty())
    private val composition = MutableStateFlow(draft?.composition.orEmpty())
    private val strength = MutableStateFlow(parsedStrength.first)
    private val strengthUnit = MutableStateFlow(parsedStrength.second)
    private val aisle = MutableStateFlow("")
    private val unitsPerPack = MutableStateFlow(draft?.unitsPerPack?.toString().orEmpty())
    private val purchasePrice = MutableStateFlow("")
    private val retailPrice = MutableStateFlow("")
    private val unitPrice = MutableStateFlow("")
    private val categoryId = MutableStateFlow("")
    private val saving = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val createdId = MutableStateFlow<String?>(null)

    val ui: StateFlow<ProductEditorUi> =
        combine(
            combine(name, composition, strength, strengthUnit, aisle) { n, c, s, su, a -> listOf(n, c, s, su, a) },
            combine(unitsPerPack, purchasePrice, retailPrice, unitPrice, categoryId) { u, p, r, up, cat ->
                listOf(u, p, r, up, cat)
            },
            combine(catalogSync.snapshot, saving, error, createdId) { snap, sv, err, id -> Triple(snap, sv to err, id) },
        ) { text, prices, rest ->
            val snapshot = rest.first
            val (sv, err) = rest.second
            val selected = prices[4].ifBlank { snapshot.categories.firstOrNull()?.id.orEmpty() }
            val tracksPacks = snapshot.categories.find { it.id == selected }?.tracksPacks ?: true
            ProductEditorUi(
                name = text[0],
                composition = text[1],
                strength = text[2],
                strengthUnit = text[3],
                aisle = text[4],
                unitsPerPack = prices[0],
                purchasePrice = prices[1],
                retailPrice = prices[2],
                unitPrice = prices[3],
                categoryId = selected,
                categories = snapshot.categories,
                tracksPacks = tracksPacks,
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

    fun setStrengthUnit(value: String) {
        strengthUnit.value = value
    }

    fun setAisle(value: String) {
        aisle.value = value
    }

    fun setUnitsPerPack(value: String) {
        unitsPerPack.value = value
        computedUnitPrice()?.let { unitPrice.value = it }
    }

    fun setPurchasePrice(value: String) {
        purchasePrice.value = value
    }

    fun setRetailPrice(value: String) {
        retailPrice.value = value
        computedUnitPrice()?.let { unitPrice.value = it }
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
            val tracksPacks = current.tracksPacks
            val units = current.unitsPerPack.trim().ifBlank { "1" }.toLongOrNull()
            if (current.name.isBlank()) {
                error.value = "Enter a product name."
                return@launch
            }
            if (tracksPacks && (units == null || units < 1)) {
                error.value = "Units per pack must be a whole number of 1 or more."
                return@launch
            }
            val purchase = CatalogValidation.priceInPaisa(current.purchasePrice)
            val retail = CatalogValidation.priceInPaisa(current.retailPrice)
            val unit = CatalogValidation.priceInPaisa(current.unitPrice)
            if (current.purchasePrice.isNotBlank() && purchase == null) {
                error.value = "Purchase price must be a valid non-negative amount."
                return@launch
            }
            if (tracksPacks && current.retailPrice.isNotBlank() && retail == null) {
                error.value = "Retail price must be a valid non-negative amount."
                return@launch
            }
            if (current.unitPrice.isNotBlank() && unit == null) {
                error.value = "Retail price must be a valid non-negative amount."
                return@launch
            }
            val strengthValue = current.strength.trim()
            val strength =
                if (strengthValue.isBlank()) {
                    null
                } else {
                    "$strengthValue${current.strengthUnit}"
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
                            strength = strength,
                            unitsPerPack = if (tracksPacks) units else 1,
                            purchasePrice = purchase,
                            retailPrice = if (tracksPacks) retail else null,
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

    private fun computedUnitPrice(): String? {
        val units = unitsPerPack.value.trim().ifBlank { "1" }.toDoubleOrNull() ?: return null
        val retail = retailPrice.value.trim().toDoubleOrNull() ?: return null
        if (units < 1 || retailPrice.value.isBlank()) return null
        return kotlin.math.round(retail / units).toLong().toString()
    }

    companion object {
        val strengthUnits = listOf("mg", "mcg", "g", "ml", "l")

        fun parseStrength(value: String?): Pair<String, String> {
            val raw = value?.trim().orEmpty()
            val match = STRENGTH.matchEntire(raw)
            return if (match == null) {
                raw to "mg"
            } else {
                match.groupValues[1] to match.groupValues[2].lowercase()
            }
        }

        private val STRENGTH = Regex("""^([\d.]+)\s*(mg|mcg|g|ml|l)$""", RegexOption.IGNORE_CASE)
        fun factory(
            catalog: CatalogRepository,
            catalogSync: CatalogSyncSession,
            draft: ProductScanResult?,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ProductEditorViewModel(catalog, catalogSync, draft) as T
        }
    }
}
