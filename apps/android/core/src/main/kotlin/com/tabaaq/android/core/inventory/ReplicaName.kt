package com.tabaaq.android.core.inventory

/**
 * Mirrors `inventoryReplicaDatabaseName` in `@store/client-db`.
 * The replica is scoped to API origin + organization, never a user.
 */
object ReplicaName {
    fun scope(
        apiBaseUrl: String,
        organizationId: String,
    ): String = "${sourceId(apiBaseUrl)}:$organizationId"

    fun databaseFile(scopeId: String): String = "powersync-inventory-${fnv1a(scopeId)}.sqlite"

    fun sourceId(apiBaseUrl: String): String {
        val normalized = apiBaseUrl.trimEnd('/')
        return try {
            val url = java.net.URI(normalized).toURL()
            buildString {
                append(url.protocol)
                append("://")
                append(url.host)
                if (url.port != -1) {
                    append(':')
                    append(url.port)
                }
            }
        } catch (_: Exception) {
            normalized.ifEmpty { "default" }
        }
    }

    internal fun fnv1a(value: String): String {
        var hash = 0x811c9dc5.toInt()
        for (code in value.codePoints()) {
            hash = (hash xor code) * 0x01000193
        }
        return hash.toUInt().toString(16).padStart(8, '0')
    }
}
