package com.tabaaq.mobile.core.inventory

object InventoryHttp {
    fun apiRoot(baseUrl: String): String {
        val normalized = baseUrl.trimEnd('/')
        return if (normalized.endsWith("/api")) normalized else "$normalized/api"
    }

    fun authRoot(baseUrl: String): String = baseUrl.trimEnd('/')
}
