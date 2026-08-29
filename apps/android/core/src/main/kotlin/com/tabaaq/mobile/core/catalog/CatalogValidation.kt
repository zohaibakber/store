package com.tabaaq.mobile.core.catalog

object CatalogValidation {
    fun requiredName(value: String): String {
        val normalized = value.trim()
        if (normalized.isEmpty()) error("Product name is required.")
        if (normalized.length > 120) error("Product name must be 120 characters or fewer.")
        return normalized
    }

    fun optionalText(
        value: String?,
        maximum: Int,
        label: String,
    ): String? {
        val normalized = value?.trim()?.takeIf { it.isNotEmpty() }
        if (normalized != null && normalized.length > maximum) {
            error("$label must be $maximum characters or fewer.")
        }
        return normalized
    }

    fun nonNegativeInteger(
        value: Long,
        label: String,
    ): Long {
        if (value < 0) error("$label must be a non-negative whole number.")
        return value
    }

    fun priceInPaisa(raw: String): Long? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val amount = trimmed.toDoubleOrNull() ?: return null
        if (amount < 0 || !amount.isFinite()) return null
        return kotlin.math.round(amount * 100.0).toLong()
    }

    fun expiryTimestamp(value: Long?): Long? {
        if (value != null && value < 0) error("Expiry date must be a valid timestamp.")
        return value
    }
}
