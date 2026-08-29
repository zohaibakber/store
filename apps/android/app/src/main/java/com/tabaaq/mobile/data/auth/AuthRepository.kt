package com.tabaaq.mobile.data.auth

import com.tabaaq.mobile.core.auth.LoginRoute
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import com.tabaaq.mobile.core.auth.authenticatedUser
import com.tabaaq.mobile.core.auth.organizationId
import com.tabaaq.mobile.core.catalog.CatalogActor
import com.tabaaq.mobile.data.firebase.FirebaseAuthSidecar
import com.tabaaq.mobile.data.network.HttpException
import com.tabaaq.mobile.data.network.needsRefresh
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface AuthState {
    data object Loading : AuthState

    data object SignedOut : AuthState

    data class SignedIn(
        val workspace: WorkspaceSnapshot,
        val offline: Boolean,
    ) : AuthState
}

class AuthRepository(
    private val api: AuthRemote,
    private val store: TokenStore,
    private val firebaseAuth: FirebaseAuthSidecar,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state

    private var tokens: TokenSet? = null

    suspend fun bootstrap() {
        val restored = store.readTokens()
        if (restored == null) {
            tokens = null
            _state.value = AuthState.SignedOut
            return
        }
        tokens = restored
        try {
            refreshIfNeeded()
            val workspace = api.workspace(requireAccessToken())
            if (workspace.authenticatedUser() == null) {
                clearLocal()
                return
            }
            store.writeWorkspace(workspace)
            _state.value = AuthState.SignedIn(workspace, offline = false)
        } catch (_: Exception) {
            val cached = store.readWorkspace()
            if (cached?.authenticatedUser() != null) {
                _state.value =
                    AuthState.SignedIn(
                        cached.copy(isOnline = false, workspaceError = "Offline. Changes will sync after you reconnect."),
                        offline = true,
                    )
            } else {
                _state.value = AuthState.SignedOut
            }
        }
    }

    suspend fun identify(email: String): LoginRoute = api.identify(email)

    suspend fun completePassword(
        email: String,
        password: String,
    ) {
        acceptTokens(api.signInPassword(email, password))
    }

    suspend fun completeOtp(
        challengeId: String,
        code: String,
    ) {
        acceptTokens(api.signInOtp(challengeId, code))
    }

    suspend fun completeRegistration(
        email: String,
        name: String,
        password: String,
    ) {
        acceptTokens(api.register(email, name, password))
    }

    suspend fun completeGoogle(idToken: String) {
        acceptTokens(api.exchangeGoogle(idToken))
        firebaseAuth.signInBesideCustomAuth(idToken)
    }

    suspend fun signOut(everywhere: Boolean = false) {
        val refresh = tokens?.refreshToken
        try {
            api.signOut(refresh, everywhere)
        } catch (_: Exception) {
            // Local sign-out still proceeds.
        }
        firebaseAuth.signOut()
        clearLocal()
    }

    suspend fun accessToken(): String? =
        mutex.withLock {
            refreshIfNeeded()
            tokens?.accessToken
        }

    fun currentOrganizationId(): String? = (state.value as? AuthState.SignedIn)?.workspace?.organizationId()

    fun currentActor(): CatalogActor? {
        val signed = state.value as? AuthState.SignedIn ?: return null
        val organizationId = signed.workspace.organizationId() ?: return null
        val userId = signed.workspace.authenticatedUser()?.id ?: return null
        return CatalogActor(organizationId = organizationId, userId = userId, deviceId = store.deviceId())
    }

    private suspend fun acceptTokens(next: TokenSet) {
        tokens = next
        store.writeTokens(next)
        val workspace = api.workspace(next.accessToken)
        if (workspace.authenticatedUser() == null) {
            clearLocal()
            throw HttpException(401, "The API did not accept the new session.")
        }
        store.writeWorkspace(workspace)
        _state.value = AuthState.SignedIn(workspace, offline = false)
    }

    private suspend fun refreshIfNeeded() {
        val current = tokens ?: return
        if (!current.needsRefresh()) return
        val refreshToken = current.refreshToken ?: return
        runCatching { api.refresh(refreshToken) }
            .onSuccess { next ->
                tokens = next
                store.writeTokens(next)
            }.onFailure { error ->
                if (error is HttpException && (error.status == 401 || error.status == 403)) {
                    clearLocal()
                }
            }
    }

    private suspend fun requireAccessToken(): String = tokens?.accessToken ?: error("Not signed in")

    private suspend fun clearLocal() {
        tokens = null
        store.writeTokens(null)
        store.writeWorkspace(null)
        _state.value = AuthState.SignedOut
    }
}
