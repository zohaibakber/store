package com.tabaaq.mobile.data.auth

import android.content.Context
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.tabaaq.mobile.data.config.AppConfig
import java.security.SecureRandom
import java.util.Base64

sealed interface GoogleSignInResult {
    data class Signed(
        val idToken: String,
    ) : GoogleSignInResult

    data object Cancelled : GoogleSignInResult

    data object Unavailable : GoogleSignInResult
}

class GoogleSignIn(
    private val config: AppConfig,
) {
    suspend fun signIn(context: Context): GoogleSignInResult {
        if (!config.googleSignInConfigured) {
            error("Google sign-in is not configured. Set GOOGLE_WEB_CLIENT_ID in local.properties.")
        }
        val manager = CredentialManager.create(context)
        return try {
            val credential =
                try {
                    manager.getCredential(context, bottomSheetRequest(filterByAuthorizedAccounts = true)).credential
                } catch (_: NoCredentialException) {
                    manager.getCredential(context, bottomSheetRequest(filterByAuthorizedAccounts = false)).credential
                }
            GoogleSignInResult.Signed(idTokenFrom(credential))
        } catch (_: GetCredentialCancellationException) {
            GoogleSignInResult.Cancelled
        } catch (_: NoCredentialException) {
            GoogleSignInResult.Unavailable
        }
    }

    private fun bottomSheetRequest(filterByAuthorizedAccounts: Boolean): GetCredentialRequest {
        val option =
            GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(filterByAuthorizedAccounts)
                .setServerClientId(config.googleWebClientId)
                .setAutoSelectEnabled(filterByAuthorizedAccounts)
                .setNonce(secureNonce())
                .build()
        return GetCredentialRequest.Builder().addCredentialOption(option).build()
    }

    private fun idTokenFrom(credential: Credential): String {
        val google =
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                GoogleIdTokenCredential.createFrom(credential.data)
            } else {
                null
            }
        val idToken = google?.idToken
        if (idToken.isNullOrBlank()) error("Google did not return an identity token.")
        return idToken
    }

    private fun secureNonce(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
