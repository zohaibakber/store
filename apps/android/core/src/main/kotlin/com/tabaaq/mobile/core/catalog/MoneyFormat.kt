package com.tabaaq.mobile.core.catalog

import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

object MoneyFormat {
    private val locale = Locale.forLanguageTag("en-PK")

    fun formatPaisa(paisa: Long?): String {
        if (paisa == null) return "—"
        val formatter = NumberFormat.getCurrencyInstance(locale)
        formatter.currency = Currency.getInstance("PKR")
        formatter.maximumFractionDigits = if (paisa % 100L == 0L) 0 else 2
        formatter.minimumFractionDigits = if (paisa % 100L == 0L) 0 else 2
        return formatter.format(paisa / 100.0)
    }
}
