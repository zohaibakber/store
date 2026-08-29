package com.tabaaq.mobile.data.auth

import com.tabaaq.mobile.core.auth.GoogleNativeBody
import com.tabaaq.mobile.core.auth.IdentifyBody
import com.tabaaq.mobile.core.auth.LoginRoute
import com.tabaaq.mobile.core.auth.OtpSignInBody
import com.tabaaq.mobile.core.auth.PasswordSignInBody
import com.tabaaq.mobile.core.auth.RefreshBody
import com.tabaaq.mobile.core.auth.RegisterBody
import com.tabaaq.mobile.core.auth.SignOutBody
import com.tabaaq.mobile.core.auth.TokenSet
import com.tabaaq.mobile.core.auth.WorkspaceSnapshot
import com.tabaaq.mobile.core.inventory.InventoryHttp
import com.tabaaq.mobile.data.network.HttpException
import com.tabaaq.mobile.data.network.HttpSupport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

interface AuthRemote {
    suspend fun identify(email: String): LoginRoute

    suspend fun signInPassword(
        email: String,
        password: String,
    ): TokenSet

    suspend fun signInOtp(
        challengeId: String,
        code: String,
    ): TokenSet

    suspend fun register(
        email: String,
        name: String,
        password: String,
    ): TokenSet

    suspend fun exchangeGoogle(idToken: String): TokenSet

    suspend fun refresh(refreshToken: String): TokenSet

    suspend fun signOut(
        refreshToken: String?,
        everywhere: Boolean,
    )

    suspend fun workspace(accessToken: String): WorkspaceSnapshot
}

class AuthApi(
    private val http: HttpSupport,
) : AuthRemote {
    private val authRoot get() = InventoryHttp.authRoot(http.config.authUrl)
    private val apiRoot get() = InventoryHttp.apiRoot(http.config.apiUrl)

    override suspend fun identify(email: String): LoginRoute =
        postAuth("$authRoot/v1/identify", http.json.encodeToString(IdentifyBody.serializer(), IdentifyBody(email))) { text ->
            decodeLoginRoute(text)
        }

    override suspend fun signInPassword(
        email: String,
        password: String,
    ): TokenSet =
        postAuth(
            "$authRoot/v1/sign-in/password",
            http.json.encodeToString(PasswordSignInBody.serializer(), PasswordSignInBody(email = email, password = password)),
        ) { http.json.decodeFromString(TokenSet.serializer(), it) }

    override suspend fun signInOtp(
        challengeId: String,
        code: String,
    ): TokenSet =
        postAuth(
            "$authRoot/v1/sign-in/otp",
            http.json.encodeToString(OtpSignInBody.serializer(), OtpSignInBody(challengeId = challengeId, code = code)),
        ) { http.json.decodeFromString(TokenSet.serializer(), it) }

    override suspend fun register(
        email: String,
        name: String,
        password: String,
    ): TokenSet =
        postAuth(
            "$authRoot/v1/sign-up/password",
            http.json.encodeToString(RegisterBody.serializer(), RegisterBody(email = email, name = name, password = password)),
        ) { http.json.decodeFromString(TokenSet.serializer(), it) }

    override suspend fun exchangeGoogle(idToken: String): TokenSet =
        postAuth(
            "$authRoot/v1/oauth/google/native",
            http.json.encodeToString(GoogleNativeBody.serializer(), GoogleNativeBody(idToken = idToken)),
        ) { http.json.decodeFromString(TokenSet.serializer(), it) }

    override suspend fun refresh(refreshToken: String): TokenSet =
        postAuth(
            "$authRoot/v1/session/refresh",
            http.json.encodeToString(RefreshBody.serializer(), RefreshBody(refreshToken)),
        ) { http.json.decodeFromString(TokenSet.serializer(), it) }

    override suspend fun signOut(
        refreshToken: String?,
        everywhere: Boolean,
    ) {
        postAuth(
            "$authRoot/v1/session/logout",
            http.json.encodeToString(SignOutBody.serializer(), SignOutBody(refreshToken, everywhere)),
        ) { }
    }

    override suspend fun workspace(accessToken: String): WorkspaceSnapshot =
        withContext(Dispatchers.IO) {
            val response = http.execute(http.request("$apiRoot/auth/session", accessToken = accessToken))
            if (response.code == 401 || response.code == 403) {
                return@withContext WorkspaceSnapshot(status = "unauthenticated", isOnline = true)
            }
            http.decodeOrThrow(response, { http.json.decodeFromString(WorkspaceSnapshot.serializer(), it) }, "The session server returned an invalid response.")
        }

    private suspend fun <T> postAuth(
        url: String,
        body: String,
        decode: (String) -> T,
    ): T =
        withContext(Dispatchers.IO) {
            val response = http.execute(http.request(url, method = "POST", body = body))
            http.decodeOrThrow(response, decode, "The authentication service returned an invalid response.")
        }

    private fun decodeLoginRoute(text: String): LoginRoute {
        val obj = http.json.decodeFromString(JsonObject.serializer(), text)
        val tag = obj["_tag"]?.jsonPrimitive?.contentOrNull
        val email = obj["email"]?.jsonPrimitive?.contentOrNull.orEmpty()
        return when (tag) {
            "Password" -> LoginRoute.Password(email)
            "Otp" ->
                LoginRoute.Otp(
                    email = email,
                    challengeId = obj["challengeId"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    developmentCode = obj["developmentCode"]?.jsonPrimitive?.contentOrNull,
                )
            "Registration" -> LoginRoute.Registration(email)
            else -> throw HttpException(0, "The authentication service returned an invalid response.", "INVALID_RESPONSE")
        }
    }
}
