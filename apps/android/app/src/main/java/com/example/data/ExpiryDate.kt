package com.example.data

import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Batches store `expiresAt` as epoch milliseconds (matching
 * packages/db/src/shared/store.schema.ts), but OCR/manual entry works with
 * human-readable strings like "12/26" or "12/2026".
 */
object ExpiryDate {
    private val formats = listOf("MM/yy", "MM/yyyy", "MM-yy", "MM-yyyy")

    fun parse(text: String): Long? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        for (pattern in formats) {
            try {
                val format = SimpleDateFormat(pattern, Locale.US).apply { isLenient = false }
                return format.parse(trimmed)?.time
            } catch (_: Exception) {
                // try next pattern
            }
        }
        return null
    }

    fun format(epochMillis: Long?): String {
        if (epochMillis == null) return ""
        return SimpleDateFormat("MM/yy", Locale.US).format(epochMillis)
    }
}
