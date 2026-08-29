package com.tabaaq.android.di

import android.content.Context
import com.tabaaq.android.data.auth.AuthApi
import com.tabaaq.android.data.auth.AuthRepository
import com.tabaaq.android.data.auth.EncryptedTokenStore
import com.tabaaq.android.data.auth.GoogleSignIn
import com.tabaaq.android.data.config.AppConfig
import com.tabaaq.android.data.firebase.FirebaseAuthBridge
import com.tabaaq.android.data.network.HttpSupport
import com.tabaaq.android.data.powersync.InventoryConnector
import com.tabaaq.android.data.powersync.PowerSyncSession
import kotlinx.serialization.json.Json

class AppContainer(
    context: Context,
) {
    val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            isLenient = true
        }
    val config = AppConfig.fromBuildConfig()
    val http = HttpSupport(config, json)
    val tokenStore = EncryptedTokenStore(context.applicationContext, json)
    val firebaseAuth = FirebaseAuthBridge()
    val authApi = AuthApi(http)
    val authRepository = AuthRepository(authApi, tokenStore, firebaseAuth)
    val googleSignIn = GoogleSignIn(config)
    val connector = InventoryConnector(http, authRepository)
    val powerSync = PowerSyncSession(context.applicationContext, config, authRepository, connector)
}
