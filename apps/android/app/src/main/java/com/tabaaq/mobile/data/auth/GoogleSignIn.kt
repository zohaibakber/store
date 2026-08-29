package com.tabaaq.mobile.data.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.tabaaq.mobile.data.config.AppConfig

sealed interface GoogleSignInResult {
    data class Signed(
        val idToken: String,
    ) : GoogleSignInResult

    data object Cancelled : GoogleSignInResult
}

class GoogleSignIn(
    private val config: AppConfig,
) {
    suspend fun signIn(context: Context): GoogleSignInResult {
        if (!config.googleSignInConfigured) {
            error("Google sign-in is not configured. Set GOOGLE_WEB_CLIENT_ID in local.properties.")
        }
        val option =
            GetGoogleIdOption.Builder()
                .setServerClientId(config.googleWebClientId)
                .setFilterByAuthorizedAccounts(false)
                .setAutoSelectEnabled(false)
                .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        return try {
            val credential = CredentialManager.create(context).getCredential(context, request).credential
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
            GoogleSignInResult.Signed(idToken)
        } catch (_: GetCredentialCancellationException) {
            GoogleSignInResult.Cancelled
        }
    }
}
