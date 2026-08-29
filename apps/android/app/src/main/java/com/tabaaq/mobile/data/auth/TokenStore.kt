package com.tabaaq.mobile.data.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json

internal const val AUTH_PREFERENCES_NAME = "tabaaq-auth"
internal const val LEGACY_ENCRYPTED_PREFS_NAME = "tabaaq-auth"

val Context.authDataStore: DataStore<Preferences> by preferencesDataStore(name = AUTH_PREFERENCES_NAME)

interface TokenStore {
    suspend fun readTokens(): TokenSet?

    suspend fun writeTokens(tokens: TokenSet?)

    suspend fun readWorkspace(): WorkspaceSnapshot?

    suspend fun writeWorkspace(snapshot: WorkspaceSnapshot?)

    fun deviceId(): String
}

/**
 * Session JWTs and workspace snapshot in Preferences DataStore.
 *
 * security-crypto 1.1.0 deprecated EncryptedSharedPreferences / MasterKey in favor of platform
 * APIs. Internal storage is app-private and credential-encrypted on FBE (minSdk 26); Android
 * security tips call that sufficient for most apps. DataStore is the SharedPreferences
 * replacement. Restore Credentials is for passkeys/passwords, not arbitrary JWTs.
 * androidx.datastore:datastore-tink (AeadSerializer) is still alpha as of DataStore 1.3.
 */
class DataStoreTokenStore(
    private val dataStore: DataStore<Preferences>,
    private val json: Json,
) : TokenStore {
    @Volatile
    private var cachedDeviceId: String? = null

    override suspend fun readTokens(): TokenSet? = decode(read(TOKENS), TokenSet.serializer())

    override suspend fun writeTokens(tokens: TokenSet?) = write(TOKENS, tokens, TokenSet.serializer())

    override suspend fun readWorkspace(): WorkspaceSnapshot? = decode(read(WORKSPACE), WorkspaceSnapshot.serializer())

    override suspend fun writeWorkspace(snapshot: WorkspaceSnapshot?) =
        write(WORKSPACE, snapshot, WorkspaceSnapshot.serializer())

    override fun deviceId(): String {
        cachedDeviceId?.let { return it }
        return runBlocking { ensureDeviceId() }
    }

    private suspend fun read(key: Preferences.Key<String>): String? =
        dataStore.data
            .catch { error ->
                if (error is IOException) emit(emptyPreferences()) else throw error
            }.map { prefs -> prefs[key] }
            .first()

    private suspend fun <T> write(
        key: Preferences.Key<String>,
        value: T?,
        serializer: kotlinx.serialization.SerializationStrategy<T>,
    ) {
        dataStore.edit { prefs ->
            if (value == null) {
                prefs.remove(key)
            } else {
                prefs[key] = json.encodeToString(serializer, value)
            }
        }
    }

    private suspend fun ensureDeviceId(): String {
        cachedDeviceId?.let { return it }
        val existing = read(DEVICE)
        if (!existing.isNullOrBlank()) {
            cachedDeviceId = existing
            return existing
        }
        val created = UUID.randomUUID().toString()
        dataStore.edit { it[DEVICE] = created }
        cachedDeviceId = created
        return created
    }

    private fun <T> decode(
        raw: String?,
        serializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T? {
        if (raw.isNullOrBlank()) return null
        return runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
    }

    private companion object {
        val TOKENS = stringPreferencesKey("tokens")
        val WORKSPACE = stringPreferencesKey("workspace")
        val DEVICE = stringPreferencesKey("device-id")
    }
}

fun createAuthTokenStore(
    context: Context,
    json: Json,
): TokenStore {
    val app = context.applicationContext
    app.deleteSharedPreferences(LEGACY_ENCRYPTED_PREFS_NAME)
    return DataStoreTokenStore(app.authDataStore, json)
}
