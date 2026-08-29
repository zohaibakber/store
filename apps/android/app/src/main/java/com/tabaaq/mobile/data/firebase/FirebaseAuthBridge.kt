package com.tabaaq.mobile.data.firebase

import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/**
 * Expo uses Firebase for Gemini product scan, not for user sessions.
 * Native Android keeps first-party JWT as the source of truth and optionally
 * signs the same Google ID token into Firebase Auth so later AI / App Check
 * work can reuse that session.
 */
interface FirebaseAuthSidecar {
    val available: Boolean

    suspend fun signInBesideCustomAuth(idToken: String)

    fun signOut()

    fun currentUid(): String?
}

class NoOpFirebaseAuth : FirebaseAuthSidecar {
    override val available: Boolean = false

    override suspend fun signInBesideCustomAuth(idToken: String) = Unit

    override fun signOut() = Unit

    override fun currentUid(): String? = null
}

class FirebaseAuthBridge : FirebaseAuthSidecar {
    override val available: Boolean
        get() = runCatching { FirebaseApp.getInstance() }.isSuccess

    override suspend fun signInBesideCustomAuth(idToken: String) {
        val app = runCatching { FirebaseApp.getInstance() }.getOrNull() ?: return
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        FirebaseAuth.getInstance(app).signInWithCredential(credential).await()
    }

    override fun signOut() {
        runCatching { FirebaseAuth.getInstance().signOut() }
    }

    override fun currentUid(): String? = runCatching { FirebaseAuth.getInstance().currentUser?.uid }.getOrNull()
}
