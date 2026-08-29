package com.tabaaq.android.data.config

import com.tabaaq.android.BuildConfig

data class AppConfig(
    val authUrl: String,
    val apiUrl: String,
    val powerSyncUrlFallback: String,
    val googleWebClientId: String,
    val nativeOrigin: String,
) {
    val googleSignInConfigured: Boolean get() = googleWebClientId.isNotBlank()

    companion object {
        fun fromBuildConfig(): AppConfig =
            AppConfig(
                authUrl = BuildConfig.AUTH_URL.trimEnd('/'),
                apiUrl = BuildConfig.API_URL.trimEnd('/'),
                powerSyncUrlFallback = BuildConfig.POWERSYNC_URL.trim(),
                googleWebClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID.trim(),
                nativeOrigin = BuildConfig.NATIVE_ORIGIN.trim().ifEmpty { "com.tabaaq.mobile://app" },
            )
    }
}
