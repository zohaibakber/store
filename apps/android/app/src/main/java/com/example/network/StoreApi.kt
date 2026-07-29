package com.example.network

import com.example.sync.SyncRequest
import com.example.sync.SyncResponse
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

@Serializable
data class SignInEmailRequest(val email: String, val password: String)

@Serializable
data class AuthUser(val id: String, val email: String, val name: String? = null)

@Serializable
data class SignInEmailResponse(
    val redirect: Boolean = false,
    val token: String? = null,
    val user: AuthUser? = null,
)

@Serializable
data class StoreOrganization(val id: String, val name: String, val slug: String? = null)

@Serializable
data class SetActiveOrganizationRequest(val organizationId: String)

/**
 * Mirrors the store-electron server's REST surface
 * (apps/server/src/http/app.ts, better-auth's email/organization plugins,
 * apps/server/src/routes/sync.ts). Auth calls rely on the `bearer()` plugin
 * (packages/auth/src/auth.ts) to accept `Authorization: Bearer <token>`
 * instead of a cookie jar — see network/AuthInterceptor.kt.
 */
interface StoreApi {
    @POST("api/auth/sign-in/email")
    suspend fun signInEmail(@Body request: SignInEmailRequest): SignInEmailResponse

    @GET("api/auth/organization/list")
    suspend fun listOrganizations(): List<StoreOrganization>

    @POST("api/auth/organization/set-active")
    suspend fun setActiveOrganization(@Body request: SetActiveOrganizationRequest): StoreOrganization?

    @POST("api/auth/sign-out")
    suspend fun signOut()

    @POST("api/sync")
    suspend fun sync(@Body request: SyncRequest): SyncResponse
}
