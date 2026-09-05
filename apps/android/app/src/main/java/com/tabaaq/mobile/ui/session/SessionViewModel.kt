package com.tabaaq.mobile.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.auth.AuthState
import com.tabaaq.mobile.data.sync.CatalogSyncSession
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class SessionViewModel(
    private val auth: AuthRepository,
    private val catalogSync: CatalogSyncSession,
) : ViewModel() {
    val authState: StateFlow<AuthState> = auth.state

    init {
        viewModelScope.launch { auth.bootstrap() }
        viewModelScope.launch {
            var lastOrganization: String? = null
            auth.state.collect { state ->
                when (state) {
                    is AuthState.SignedIn -> {
                        val organizationId = auth.currentOrganizationId()
                        if (organizationId != lastOrganization) {
                            lastOrganization = organizationId
                            if (organizationId != null) {
                                catalogSync.start(organizationId)
                            } else {
                                catalogSync.stop()
                            }
                        }
                    }
                    AuthState.SignedOut -> {
                        lastOrganization = null
                        catalogSync.stop()
                    }
                    AuthState.Loading -> Unit
                }
            }
        }
    }

    companion object {
        fun factory(
            auth: AuthRepository,
            catalogSync: CatalogSyncSession,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = SessionViewModel(auth, catalogSync) as T
        }
    }
}
