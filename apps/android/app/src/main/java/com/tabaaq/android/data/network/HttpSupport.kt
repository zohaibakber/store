package com.tabaaq.android.data.network

import com.tabaaq.android.core.auth.AuthErrorBody
import com.tabaaq.android.core.auth.TokenSet
import com.tabaaq.android.data.config.AppConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

class HttpException(
    val status: Int,
    override val message: String,
    val code: String = "REQUEST_FAILED",
) : Exception(message)

class HttpSupport(
    val config: AppConfig,
    val json: Json,
) {
    val client: OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                },
            ).build()

    fun jsonBody(value: String) = value.toRequestBody(JSON)

    fun request(
        url: String,
        method: String = "GET",
        body: String? = null,
        accessToken: String? = null,
    ): Request {
        val builder =
            Request.Builder()
                .url(url)
                .addHeader("Accept", "application/json")
                .addHeader("expo-origin", config.nativeOrigin)
        if (accessToken != null) {
            builder.addHeader("Authorization", "Bearer $accessToken")
        }
        if (body != null) {
            builder.method(method, jsonBody(body))
            builder.addHeader("Content-Type", "application/json")
        } else {
            builder.method(method, null)
        }
        return builder.build()
    }

    fun execute(request: Request): Response = client.newCall(request).execute()

    fun <T> decodeOrThrow(
        response: Response,
        decode: (String) -> T,
        fallbackMessage: String,
    ): T {
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val parsed = runCatching { json.decodeFromString(AuthErrorBody.serializer(), text) }.getOrNull()
            throw HttpException(
                status = response.code,
                code = parsed?.error?.code ?: "REQUEST_FAILED",
                message = parsed?.error?.message ?: parsed?.message ?: fallbackMessage,
            )
        }
        return runCatching { decode(text) }.getOrElse {
            throw HttpException(response.code, fallbackMessage, "INVALID_RESPONSE")
        }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

fun TokenSet.needsRefresh(now: Long = System.currentTimeMillis()): Boolean = accessExpiresAt <= now + 60_000
