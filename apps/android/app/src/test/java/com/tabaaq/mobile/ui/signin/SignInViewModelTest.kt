package com.tabaaq.mobile.ui.signin

import com.google.common.truth.Truth.assertThat
import com.tabaaq.mobile.core.auth.LoginRoute
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceOrganization
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import com.tabaaq.mobile.core.auth.WorkspaceUser
import com.tabaaq.mobile.data.auth.AuthRemote
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.auth.GoogleSignIn
import com.tabaaq.mobile.data.auth.TokenStore
import com.tabaaq.mobile.data.config.AppConfig
import com.tabaaq.mobile.data.firebase.NoOpFirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setMain() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun reset() {
        Dispatchers.resetMain()
    }

    @Test
    fun rejectsInvalidEmailWithoutCallingIdentify() =
        runTest(dispatcher) {
            var identified = false
            val viewModel =
                viewModel(
                    object : RecordingAuthRemote() {
                        override suspend fun identify(email: String): LoginRoute {
                            identified = true
                            return LoginRoute.Password(email)
                        }
                    },
                )
            viewModel.setEmail("not-an-email")
            viewModel.continueWithEmail()
            advanceUntilIdle()
            assertThat(viewModel.ui.value.error).isEqualTo("Enter a valid email.")
            assertThat(identified).isFalse()
        }

    @Test
    fun passwordTooShortStaysOnPasswordStep() =
        runTest(dispatcher) {
            val viewModel =
                viewModel(
                    object : RecordingAuthRemote() {
                        override suspend fun identify(email: String) = LoginRoute.Password(email)
                    },
                )
            viewModel.setEmail("owner@tabaaq.app")
            viewModel.continueWithEmail()
            advanceUntilIdle()
            viewModel.setPassword("short")
            viewModel.submit()
            advanceUntilIdle()
            assertThat(viewModel.ui.value.error).isEqualTo("Password must be at least 10 characters.")
            assertThat(viewModel.ui.value.route).isInstanceOf(LoginRoute.Password::class.java)
        }

    @Test
    fun successfulPasswordSignInLoadsWorkspace() =
        runTest(dispatcher) {
            val remote =
                object : RecordingAuthRemote() {
                    override suspend fun identify(email: String) = LoginRoute.Password(email)

                    override suspend fun signInPassword(
                        email: String,
                        password: String,
                    ) = TokenSet("access", System.currentTimeMillis() + 60_000, "refresh", 0)

                    override suspend fun workspace(accessToken: String) =
                        WorkspaceSnapshot(
                            status = "authenticated",
                            user = WorkspaceUser("u1", "Owner", "owner@tabaaq.app"),
                            activeOrganization = WorkspaceOrganization("org1", "Store", role = "owner"),
                        )
                }
            val repo = AuthRepository(remote, MemoryTokenStore(), NoOpFirebaseAuth())
            val viewModel = SignInViewModel(repo, GoogleSignIn(config()), config())
            viewModel.setEmail("owner@tabaaq.app")
            viewModel.continueWithEmail()
            advanceUntilIdle()
            viewModel.setPassword("longenoughpassword")
            viewModel.submit()
            advanceUntilIdle()
            assertThat(viewModel.ui.value.error).isNull()
            assertThat(repo.state.value).isInstanceOf(com.tabaaq.mobile.data.auth.AuthState.SignedIn::class.java)
        }

    private fun viewModel(remote: AuthRemote): SignInViewModel {
        val repo = AuthRepository(remote, MemoryTokenStore(), NoOpFirebaseAuth())
        return SignInViewModel(repo, GoogleSignIn(config()), config())
    }

    private fun config() =
        AppConfig(
            authUrl = "http://auth",
            apiUrl = "http://api",
            powerSyncUrlFallback = "",
            googleWebClientId = "",
            nativeOrigin = "com.tabaaq.mobile://app",
        )
}

private open class RecordingAuthRemote : AuthRemote {
    override suspend fun identify(email: String): LoginRoute = throw UnsupportedOperationException("identify")

    override suspend fun signInPassword(
        email: String,
        password: String,
    ): TokenSet = throw UnsupportedOperationException("password")

    override suspend fun signInOtp(
        challengeId: String,
        code: String,
    ): TokenSet = throw UnsupportedOperationException("otp")

    override suspend fun register(
        email: String,
        name: String,
        password: String,
    ): TokenSet = throw UnsupportedOperationException("register")

    override suspend fun exchangeGoogle(idToken: String): TokenSet = throw UnsupportedOperationException("google")

    override suspend fun refresh(refreshToken: String): TokenSet = throw UnsupportedOperationException("refresh")

    override suspend fun signOut(
        refreshToken: String?,
        everywhere: Boolean,
    ) = Unit

    override suspend fun workspace(accessToken: String): WorkspaceSnapshot =
        throw UnsupportedOperationException("workspace")
}

private class MemoryTokenStore : TokenStore {
    private var tokens: TokenSet? = null
    private var workspace: WorkspaceSnapshot? = null

    override suspend fun readTokens() = tokens

    override suspend fun writeTokens(tokens: TokenSet?) {
        this.tokens = tokens
    }

    override suspend fun readWorkspace() = workspace

    override suspend fun writeWorkspace(snapshot: WorkspaceSnapshot?) {
        workspace = snapshot
    }

    override fun deviceId() = "device-test"
}
