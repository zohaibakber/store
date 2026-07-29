package com.example.network

import com.example.BuildConfig
import com.example.auth.SessionStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** A 401 means the session is no longer valid server-side — don't retry, just sign the app out. */
private class SignOutOnUnauthorized(private val sessionStore: SessionStore) : Authenticator {
    override fun authenticate(route: Route?, response: okhttp3.Response): Request? {
        runBlocking { sessionStore.clearSession() }
        return null
    }
}

class NetworkModule(private val sessionStore: SessionStore) {
    private val json = Json { ignoreUnknownKeys = true }

    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(AuthInterceptor(sessionStore))
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
                },
            )
            .authenticator(SignOutOnUnauthorized(sessionStore))
            .build()
    }

    val storeApi: StoreApi by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.STORE_API_BASE_URL.let { if (it.endsWith("/")) it else "$it/" })
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(StoreApi::class.java)
    }
}
