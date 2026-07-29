package com.example.auth

import com.example.network.AuthUser
import com.example.network.SetActiveOrganizationRequest
import com.example.network.SignInEmailRequest
import com.example.network.StoreApi
import com.example.network.StoreOrganization

class AuthRepository(
    private val api: StoreApi,
    private val sessionStore: SessionStore,
) {
    suspend fun signIn(email: String, password: String): Result<AuthUser> = runCatching {
        val response = api.signInEmail(SignInEmailRequest(email, password))
        val token = response.token ?: error("Sign-in succeeded but no session token was returned")
        val user = response.user ?: error("Sign-in succeeded but no user was returned")
        sessionStore.saveToken(token)
        sessionStore.saveUserId(user.id)
        user
    }

    suspend fun listOrganizations(): Result<List<StoreOrganization>> = runCatching {
        api.listOrganizations()
    }

    suspend fun setActiveOrganization(organizationId: String): Result<StoreOrganization> = runCatching {
        val organization = api.setActiveOrganization(SetActiveOrganizationRequest(organizationId))
            ?: error("Couldn't set active organization")
        sessionStore.setActiveOrganization(organization.id, organization.name)
        organization
    }

    suspend fun signOut() {
        runCatching { api.signOut() }
        sessionStore.clearSession()
    }
}
