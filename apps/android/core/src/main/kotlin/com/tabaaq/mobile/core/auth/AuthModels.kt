@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package com.tabaaq.mobile.core.auth

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TokenSet(
    val accessToken: String,
    val accessExpiresAt: Long,
    val refreshToken: String? = null,
    val refreshExpiresAt: Long,
)

@Serializable
data class AuthErrorBody(
    val error: AuthErrorDetail? = null,
    val message: String? = null,
)

@Serializable
data class AuthErrorDetail(
    val code: String,
    val message: String,
)

@Serializable
sealed class LoginRoute {
    @Serializable
    @SerialName("Password")
    data class Password(
        val email: String,
    ) : LoginRoute()

    @Serializable
    @SerialName("Otp")
    data class Otp(
        val email: String,
        val challengeId: String,
        val developmentCode: String? = null,
    ) : LoginRoute()

    @Serializable
    @SerialName("Registration")
    data class Registration(
        val email: String,
    ) : LoginRoute()
}

@Serializable
data class IdentifyBody(
    val email: String,
)

@Serializable
data class PasswordSignInBody(
    @EncodeDefault
    val _tag: String = "Password",
    val email: String,
    val password: String,
    @EncodeDefault
    val client: NativeClient = NativeClient(),
)

@Serializable
data class OtpSignInBody(
    @EncodeDefault
    val _tag: String = "Otp",
    val challengeId: String,
    val code: String,
    @EncodeDefault
    val client: NativeClient = NativeClient(),
)

@Serializable
data class RegisterBody(
    @EncodeDefault
    val _tag: String = "RegisterPassword",
    val email: String,
    val name: String,
    val password: String,
    @EncodeDefault
    val client: NativeClient = NativeClient(),
)

@Serializable
data class NativeClient(
    @EncodeDefault
    val _tag: String = "Native",
    @EncodeDefault
    val deviceName: String = "Tabaaq Android",
)

@Serializable
data class GoogleNativeBody(
    val idToken: String,
    @EncodeDefault
    val client: NativeClient = NativeClient(),
)

@Serializable
data class RefreshBody(
    val refreshToken: String,
)

@Serializable
data class SignOutBody(
    val refreshToken: String? = null,
    val everywhere: Boolean = false,
)

@Serializable
data class WorkspaceUser(
    val id: String,
    val name: String,
    val email: String,
    val image: String? = null,
)

@Serializable
data class WorkspaceOrganization(
    val id: String,
    val name: String,
    val slug: String? = null,
    val image: String? = null,
    val role: String,
)

@Serializable
data class WorkspaceSnapshot(
    val status: String,
    val user: WorkspaceUser? = null,
    val activeOrganization: WorkspaceOrganization? = null,
    val organizations: List<WorkspaceOrganization> = emptyList(),
    val isOnline: Boolean = true,
    val workspaceError: String? = null,
)

fun WorkspaceSnapshot.authenticatedUser(): WorkspaceUser? = if (status == "authenticated") user else null

fun WorkspaceSnapshot.organizationId(): String? =
    activeOrganization?.id ?: organizations.firstOrNull()?.id

object AuthValidation {
    private val emailPattern = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

    fun normalizeEmail(email: String): String = email.trim().lowercase()

    fun isEmail(email: String): Boolean {
        val value = normalizeEmail(email)
        return value.length in 3..320 && emailPattern.matches(value)
    }

    fun isPassword(password: String): Boolean = password.length in 10..100 && password == password.trim()

    fun isOtp(code: String): Boolean = code.matches(Regex("^\\d{6}$"))
}
