package com.example.ui.theme

import androidx.compose.ui.graphics.Color

// Ported from the desktop design system's neutral/semantic tokens in
// apps/desktop/src/styles.css (Tailwind v4 @theme block). Keep in sync by
// hand until the two apps share a token package.

val Neutral50 = Color(0xFFFAFAFA)
val Neutral100 = Color(0xFFF5F5F5)
val Neutral400 = Color(0xFFA3A3A3)
val Neutral500 = Color(0xFF737373)
val Neutral800 = Color(0xFF262626)
val Neutral950 = Color(0xFF0A0A0A)

val Red500 = Color(0xFFEF4444)
val Red700 = Color(0xFFB91C1C)
val Red400 = Color(0xFFF87171)

val Amber500 = Color(0xFFF59E0B)
val Amber700 = Color(0xFFB45309)
val Amber400 = Color(0xFFFBBF24)

val Emerald500 = Color(0xFF10B981)
val Emerald700 = Color(0xFF047857)
val Emerald400 = Color(0xFF34D399)

val Blue500 = Color(0xFF3B82F6)
val Blue700 = Color(0xFF1D4ED8)
val Blue400 = Color(0xFF60A5FA)

/** Semantic colors that Material3's ColorScheme has no slot for. */
data class SemanticColors(
    val warning: Color,
    val warningForeground: Color,
    val success: Color,
    val successForeground: Color,
    val info: Color,
    val infoForeground: Color,
)

val LightSemanticColors = SemanticColors(
    warning = Amber500,
    warningForeground = Amber700,
    success = Emerald500,
    successForeground = Emerald700,
    info = Blue500,
    infoForeground = Blue700,
)

val DarkSemanticColors = SemanticColors(
    warning = Amber500,
    warningForeground = Amber400,
    success = Emerald500,
    successForeground = Emerald400,
    info = Blue500,
    infoForeground = Blue400,
)
