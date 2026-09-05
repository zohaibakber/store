package com.tabaaq.mobile.di

import android.content.Context
import com.tabaaq.mobile.data.auth.AuthApi
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.auth.createAuthTokenStore
import com.tabaaq.mobile.data.auth.GoogleSignIn
import com.tabaaq.mobile.data.config.AppConfig
import com.tabaaq.mobile.data.firebase.FirebaseAuthBridge
import com.tabaaq.mobile.data.firebase.FirebaseProductScan
import com.tabaaq.mobile.data.network.HttpSupport
import com.tabaaq.mobile.data.catalog.CatalogRepository
import com.tabaaq.mobile.data.sync.CatalogSyncSession
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
    val tokenStore = createAuthTokenStore(context, json)
    val firebaseAuth = FirebaseAuthBridge()
    val authApi = AuthApi(http)
    val authRepository = AuthRepository(authApi, tokenStore, firebaseAuth)
    val googleSignIn = GoogleSignIn(config)
    val catalogSync = CatalogSyncSession(context.applicationContext, config, authRepository, http)
    val catalogRepository = CatalogRepository(authRepository, catalogSync)
    val productScan = FirebaseProductScan()
}
