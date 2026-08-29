package com.tabaaq.mobile.di

import android.content.Context
import com.tabaaq.mobile.data.auth.AuthApi
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.auth.EncryptedTokenStore
import com.tabaaq.mobile.data.auth.GoogleSignIn
import com.tabaaq.mobile.data.config.AppConfig
import com.tabaaq.mobile.data.firebase.FirebaseAuthBridge
import com.tabaaq.mobile.data.network.HttpSupport
import com.tabaaq.mobile.data.powersync.InventoryConnector
import com.tabaaq.mobile.data.powersync.PowerSyncSession
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
