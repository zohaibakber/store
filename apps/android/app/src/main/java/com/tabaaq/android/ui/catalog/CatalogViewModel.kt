package com.tabaaq.android.ui.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.android.core.catalog.CatalogFilter
import com.tabaaq.android.core.catalog.CatalogProduct
import com.tabaaq.android.core.catalog.CatalogSnapshot
import com.tabaaq.android.core.catalog.InventoryOverview
import com.tabaaq.android.core.catalog.StockFilter
import com.tabaaq.android.data.auth.AuthRepository
import com.tabaaq.android.data.auth.AuthState
import com.tabaaq.android.data.powersync.PowerSyncSession
import com.tabaaq.android.data.powersync.SyncUiState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class CatalogUiState(
    val query: String = "",
    val filter: StockFilter = StockFilter.All,
    val products: List<CatalogProduct> = emptyList(),
    val filtered: List<CatalogProduct> = emptyList(),
    val overview: InventoryOverview = InventoryOverview(0, 0, 0, 0),
    val attention: List<CatalogProduct> = emptyList(),
    val sync: SyncUiState = SyncUiState(),
    val organizationMissing: Boolean = false,
    val offline: Boolean = false,
    val workspaceError: String? = null,
)

class CatalogViewModel(
    auth: AuthRepository,
    powerSync: PowerSyncSession,
) : ViewModel() {
    private val query = MutableStateFlow("")
    private val filter = MutableStateFlow(StockFilter.All)

    val ui: StateFlow<CatalogUiState> =
        combine(powerSync.snapshot, powerSync.sync, auth.state, query, filter) {
                snapshot: CatalogSnapshot,
                sync: SyncUiState,
                authState: AuthState,
                queryValue: String,
                filterValue: StockFilter,
            ->
            val signed = authState as? AuthState.SignedIn
            CatalogUiState(
                query = queryValue,
                filter = filterValue,
                products = snapshot.products,
                filtered = CatalogFilter.filter(snapshot.products, queryValue, filterValue),
                overview = CatalogFilter.overview(snapshot.products),
                attention = CatalogFilter.needsAttention(snapshot.products),
                sync = sync,
                organizationMissing = signed != null && signed.workspace.activeOrganization == null && signed.workspace.organizations.isEmpty(),
                offline = signed?.offline == true,
                workspaceError = signed?.workspace?.workspaceError,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CatalogUiState())

    fun setQuery(value: String) {
        query.value = value
    }

    fun setFilter(value: StockFilter) {
        filter.value = value
    }

    companion object {
        fun factory(
            auth: AuthRepository,
            powerSync: PowerSyncSession,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = CatalogViewModel(auth, powerSync) as T
        }
    }
}
