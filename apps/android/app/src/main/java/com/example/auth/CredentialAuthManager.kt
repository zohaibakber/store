package com.example.auth

import android.content.Context
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException

/**
 * Password autofill/retrieval via Credential Manager — the current
 * replacement for the deprecated Play Services SmartLock/CredentialsClient
 * APIs. There's no federated login server-side (email+password only), so
 * this only ever deals in [PasswordCredential], never a Google ID token.
 *
 * [CredentialManager.getCredential]/[createCredential] need an Activity
 * context to present system UI, so callers pass one in per call rather than
 * this class holding a reference to it.
 */
class CredentialAuthManager(applicationContext: Context) {
    data class SavedCredential(val email: String, val password: String)

    private val credentialManager = CredentialManager.create(applicationContext)

    suspend fun trySilentSignIn(activityContext: Context): SavedCredential? = try {
        val request = GetCredentialRequest(credentialOptions = listOf(GetPasswordOption()))
        val response = credentialManager.getCredential(activityContext, request)
        (response.credential as? PasswordCredential)?.let { SavedCredential(it.id, it.password) }
    } catch (_: GetCredentialException) {
        null
    }

    suspend fun saveCredential(activityContext: Context, email: String, password: String) {
        try {
            credentialManager.createCredential(activityContext, CreatePasswordRequest(email, password))
        } catch (_: CreateCredentialException) {
            // Best-effort — sign-in already succeeded regardless of whether saving worked.
        }
    }
}
