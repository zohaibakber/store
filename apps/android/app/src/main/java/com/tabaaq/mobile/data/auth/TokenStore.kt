package com.tabaaq.mobile.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import kotlinx.serialization.json.Json

interface TokenStore {
    suspend fun readTokens(): TokenSet?

    suspend fun writeTokens(tokens: TokenSet?)

    suspend fun readWorkspace(): WorkspaceSnapshot?

    suspend fun writeWorkspace(snapshot: WorkspaceSnapshot?)
}

class EncryptedTokenStore(
    context: Context,
    private val json: Json,
) : TokenStore {
    private val prefs =
        EncryptedSharedPreferences.create(
            context,
            "tabaaq-auth",
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    override suspend fun readTokens(): TokenSet? = decode(prefs.getString(TOKENS, null), TokenSet.serializer())

    override suspend fun writeTokens(tokens: TokenSet?) = write(TOKENS, tokens, TokenSet.serializer())

    override suspend fun readWorkspace(): WorkspaceSnapshot? =
        decode(prefs.getString(WORKSPACE, null), WorkspaceSnapshot.serializer())

    override suspend fun writeWorkspace(snapshot: WorkspaceSnapshot?) =
        write(WORKSPACE, snapshot, WorkspaceSnapshot.serializer())

    private fun <T> decode(
        raw: String?,
        serializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T? {
        if (raw.isNullOrBlank()) return null
        return runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
    }

    private fun <T> write(
        key: String,
        value: T?,
        serializer: kotlinx.serialization.SerializationStrategy<T>,
    ) {
        prefs.edit().apply {
            if (value == null) remove(key) else putString(key, json.encodeToString(serializer, value))
            apply()
        }
    }

    private companion object {
        const val TOKENS = "tokens"
        const val WORKSPACE = "workspace"
    }
}
