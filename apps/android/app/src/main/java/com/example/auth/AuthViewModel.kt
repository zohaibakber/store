package com.example.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.example.network.StoreOrganization
import com.example.sync.SyncWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AppSessionState {
    data object Loading : AppSessionState
    data object SignedOut : AppSessionState
    data class NeedsOrganization(val organizations: List<StoreOrganization>) : AppSessionState
    data object Ready : AppSessionState
}

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val sessionStore: SessionStore,
    private val credentialAuthManager: CredentialAuthManager,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _sessionState = MutableStateFlow<AppSessionState>(AppSessionState.Loading)
    val sessionState: StateFlow<AppSessionState> = _sessionState

    private val _isBusy = MutableStateFlow(false)
    val isBusy: StateFlow<Boolean> = _isBusy

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    init {
        viewModelScope.launch {
            combine(sessionStore.initialized, sessionStore.tokenFlow) { initialized, token -> initialized to token }
                .collect { (initialized, token) ->
                    if (!initialized) return@collect
                    if (token == null) {
                        _sessionState.value = AppSessionState.SignedOut
                    } else if (_sessionState.value !is AppSessionState.Ready) {
                        resolveOrganization()
                    }
                }
        }
    }

    private suspend fun resolveOrganization() {
        if (sessionStore.activeOrganizationIdFlow.first() != null) {
            _sessionState.value = AppSessionState.Ready
            return
        }
        val organizations = authRepository.listOrganizations().getOrElse {
            _error.value = it.localizedMessage ?: "Couldn't load organizations"
            _sessionState.value = AppSessionState.SignedOut
            return
        }
        when {
            organizations.isEmpty() -> {
                _error.value = "Your account isn't a member of any organization yet."
                _sessionState.value = AppSessionState.SignedOut
            }
            organizations.size == 1 -> selectOrganization(organizations.first().id)
            else -> _sessionState.value = AppSessionState.NeedsOrganization(organizations)
        }
    }

    fun signIn(activityContext: Context, email: String, password: String) {
        viewModelScope.launch {
            _isBusy.value = true
            _error.value = null
            authRepository.signIn(email, password)
                .onSuccess { credentialAuthManager.saveCredential(activityContext, email, password) }
                .onFailure { _error.value = it.localizedMessage ?: "Sign-in failed" }
            _isBusy.value = false
        }
    }

    fun trySilentSignIn(activityContext: Context) {
        viewModelScope.launch {
            val saved = credentialAuthManager.trySilentSignIn(activityContext) ?: return@launch
            signIn(activityContext, saved.email, saved.password)
        }
    }

    fun selectOrganization(organizationId: String) {
        viewModelScope.launch {
            _isBusy.value = true
            authRepository.setActiveOrganization(organizationId)
                .onSuccess { _sessionState.value = AppSessionState.Ready }
                .onFailure { _error.value = it.localizedMessage ?: "Couldn't select organization" }
            _isBusy.value = false
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
            SyncWorker.cancelPeriodic(workManager)
        }
    }

    fun dismissError() {
        _error.value = null
    }
}

class AuthViewModelFactory(
    private val authRepository: AuthRepository,
    private val sessionStore: SessionStore,
    private val credentialAuthManager: CredentialAuthManager,
    private val workManager: WorkManager,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(AuthViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return AuthViewModel(authRepository, sessionStore, credentialAuthManager, workManager) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
