package com.example.network

import com.example.auth.SessionStore
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Attaches the stored bearer token to every request. Reads
 * [SessionStore.currentToken], a synchronous, in-memory mirror of the
 * (Keystore-encrypted) DataStore value — OkHttp interceptors run on a
 * dispatcher thread and must not suspend.
 */
class AuthInterceptor(private val sessionStore: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = sessionStore.currentToken()
        val request = chain.request().let {
            if (token == null) it else it.newBuilder().addHeader("Authorization", "Bearer $token").build()
        }
        return chain.proceed(request)
    }
}
