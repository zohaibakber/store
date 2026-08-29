package com.tabaaq.mobile.ui.signin

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tabaaq.mobile.core.auth.AuthValidation
import com.tabaaq.mobile.core.auth.LoginRoute
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.auth.GoogleSignIn
import com.tabaaq.mobile.data.auth.GoogleSignInResult
import com.tabaaq.mobile.data.config.AppConfig
import com.tabaaq.mobile.data.network.HttpException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SignInUiState(
    val email: String = "",
    val password: String = "",
    val name: String = "",
    val code: String = "",
    val route: LoginRoute? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val googleConfigured: Boolean = false,
)

class SignInViewModel(
    private val auth: AuthRepository,
    private val googleSignIn: GoogleSignIn,
    config: AppConfig,
) : ViewModel() {
    private val _ui = MutableStateFlow(SignInUiState(googleConfigured = config.googleSignInConfigured))
    val ui: StateFlow<SignInUiState> = _ui

    fun setEmail(value: String) = _ui.update { it.copy(email = value, error = null) }

    fun setPassword(value: String) = _ui.update { it.copy(password = value, error = null) }

    fun setName(value: String) = _ui.update { it.copy(name = value, error = null) }

    fun setCode(value: String) = _ui.update { it.copy(code = value, error = null) }

    fun startOver() = _ui.update { it.copy(route = null, password = "", code = "", name = "", error = null) }

    fun continueWithEmail() =
        runOp {
            val email = AuthValidation.normalizeEmail(_ui.value.email)
            if (!AuthValidation.isEmail(email)) {
                _ui.update { it.copy(error = "Enter a valid email.") }
                return@runOp
            }
            _ui.update { it.copy(email = email, route = auth.identify(email)) }
        }

    fun submit() =
        runOp {
            when (val route = _ui.value.route) {
                is LoginRoute.Password -> {
                    if (!AuthValidation.isPassword(_ui.value.password)) {
                        _ui.update { it.copy(error = "Password must be at least 10 characters.") }
                        return@runOp
                    }
                    auth.completePassword(route.email, _ui.value.password)
                }
                is LoginRoute.Otp -> {
                    if (!AuthValidation.isOtp(_ui.value.code)) {
                        _ui.update { it.copy(error = "Enter the 6-digit code.") }
                        return@runOp
                    }
                    auth.completeOtp(route.challengeId, _ui.value.code)
                }
                is LoginRoute.Registration -> {
                    if (_ui.value.name.trim().isEmpty()) {
                        _ui.update { it.copy(error = "Enter your name.") }
                        return@runOp
                    }
                    if (!AuthValidation.isPassword(_ui.value.password)) {
                        _ui.update { it.copy(error = "Password must be at least 10 characters.") }
                        return@runOp
                    }
                    auth.completeRegistration(route.email, _ui.value.name.trim(), _ui.value.password)
                }
                null -> Unit
            }
        }

    fun resendCode() =
        runOp {
            val route = _ui.value.route as? LoginRoute.Otp ?: return@runOp
            _ui.update { it.copy(code = "", route = auth.identify(route.email)) }
        }

    fun continueWithGoogle(context: Context) =
        runOp {
            when (val result = googleSignIn.signIn(context)) {
                GoogleSignInResult.Cancelled -> Unit
                is GoogleSignInResult.Signed -> auth.completeGoogle(result.idToken)
            }
        }

    private fun runOp(block: suspend () -> Unit) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, error = null) }
            try {
                block()
            } catch (error: Exception) {
                _ui.update { it.copy(error = messageFor(error)) }
            } finally {
                _ui.update { it.copy(busy = false) }
            }
        }
    }

    private fun messageFor(error: Throwable): String =
        when (error) {
            is HttpException -> error.message
            else -> error.message ?: "Something went wrong. Please try again."
        }

    companion object {
        fun factory(
            auth: AuthRepository,
            googleSignIn: GoogleSignIn,
            config: AppConfig,
        ) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = SignInViewModel(auth, googleSignIn, config) as T
        }
    }
}
