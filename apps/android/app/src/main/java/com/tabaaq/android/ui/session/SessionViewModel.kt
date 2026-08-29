package com.tabaaq.android.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.android.data.auth.AuthRepository
import com.tabaaq.android.data.auth.AuthState
import com.tabaaq.android.data.powersync.PowerSyncSession
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class SessionViewModel(
    private val auth: AuthRepository,
    private val powerSync: PowerSyncSession,
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
                                powerSync.start(organizationId)
                            } else {
                                powerSync.stop()
                            }
                        }
                    }
                    AuthState.SignedOut -> {
                        lastOrganization = null
                        powerSync.stop()
                    }
                    AuthState.Loading -> Unit
                }
            }
        }
    }

    companion object {
        fun factory(
            auth: AuthRepository,
            powerSync: PowerSyncSession,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = SessionViewModel(auth, powerSync) as T
        }
    }
}
