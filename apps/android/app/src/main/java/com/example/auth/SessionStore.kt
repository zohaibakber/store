package com.example.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "session")

/**
 * Session/device state, Keystore-encrypted where it's sensitive (the bearer
 * token). Take [context] as an application context — this outlives any
 * single Activity.
 */
class SessionStore(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private object Keys {
        val token = stringPreferencesKey("session_token_enc")
        val userId = stringPreferencesKey("user_id")
        val activeOrganizationId = stringPreferencesKey("active_organization_id")
        val deviceId = stringPreferencesKey("device_id")
        val clientSequence = stringPreferencesKey("client_sequence")
        val syncCursor = stringPreferencesKey("sync_cursor")
    }

    private val _token = MutableStateFlow<String?>(null)

    /** Emits null on sign-out/expiry — UI navigates to sign-in when this goes null. */
    val tokenFlow: StateFlow<String?> = _token

    private val _initialized = MutableStateFlow(false)

    /** True once [tokenFlow] reflects what's actually on disk — see [AuthViewModel] for why this matters. */
    val initialized: StateFlow<Boolean> = _initialized

    val activeOrganizationIdFlow: Flow<String?> =
        appContext.dataStore.data.map { it[Keys.activeOrganizationId] }

    init {
        appContext.dataStore.data
            .map { prefs -> prefs[Keys.token]?.let(::decrypt) }
            .onEach {
                _token.value = it
                _initialized.value = true
            }
            .launchIn(scope)
    }

    /** Synchronous read for [com.example.network.AuthInterceptor], which cannot suspend. */
    fun currentToken(): String? = _token.value

    suspend fun saveToken(token: String) {
        appContext.dataStore.edit { it[Keys.token] = encrypt(token) }
    }

    suspend fun saveUserId(userId: String) {
        appContext.dataStore.edit { it[Keys.userId] = userId }
    }

    suspend fun userId(): String? = appContext.dataStore.data.first()[Keys.userId]

    suspend fun clearSession() {
        appContext.dataStore.edit {
            it.remove(Keys.token)
            it.remove(Keys.userId)
            it.remove(Keys.activeOrganizationId)
        }
    }

    suspend fun setActiveOrganizationId(organizationId: String) {
        appContext.dataStore.edit { it[Keys.activeOrganizationId] = organizationId }
    }

    /** Stable per-install id, generated once, reused as the sync protocol's deviceId. */
    suspend fun deviceId(): String {
        appContext.dataStore.data.first()[Keys.deviceId]?.let { return it }
        val generated = UUID.randomUUID().toString()
        appContext.dataStore.edit { it[Keys.deviceId] = generated }
        return generated
    }

    suspend fun nextClientSequence(): Long {
        var next = 0L
        appContext.dataStore.edit { prefs ->
            next = (prefs[Keys.clientSequence]?.toLongOrNull() ?: 0L) + 1
            prefs[Keys.clientSequence] = next.toString()
        }
        return next
    }

    suspend fun syncCursor(): Long =
        appContext.dataStore.data.first()[Keys.syncCursor]?.toLongOrNull() ?: 0L

    suspend fun saveSyncCursor(cursor: Long) {
        appContext.dataStore.edit { it[Keys.syncCursor] = cursor.toString() }
    }

    // --- Keystore-backed AES-256-GCM encryption for the token at rest ---

    private val keyAlias = "store_session_key"

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return keyGenerator.generateKey()
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val cipherText = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + cipherText, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String? = try {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, 12)
        val cipherText = combined.copyOfRange(12, combined.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(cipherText), Charsets.UTF_8)
    } catch (_: Exception) {
        null
    }
}
