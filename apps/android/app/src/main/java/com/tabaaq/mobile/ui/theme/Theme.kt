package com.tabaaq.mobile.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors =
    lightColorScheme(
        primary = Color(0xFF006B54),
        onPrimary = Color(0xFFFFFFFF),
        primaryContainer = Color(0xFFA3F2D4),
        onPrimaryContainer = Color(0xFF002118),
        secondary = Color(0xFF4A6359),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFCDE8DB),
        onSecondaryContainer = Color(0xFF072019),
        tertiary = Color(0xFF765A00),
        onTertiary = Color(0xFFFFFFFF),
        tertiaryContainer = Color(0xFFFFDF96),
        onTertiaryContainer = Color(0xFF251A00),
        error = Color(0xFFBA1A1A),
        onError = Color(0xFFFFFFFF),
        errorContainer = Color(0xFFFFDAD6),
        onErrorContainer = Color(0xFF410002),
        background = Color(0xFFF6FBF8),
        onBackground = Color(0xFF171D1A),
        surface = Color(0xFFF6FBF8),
        onSurface = Color(0xFF171D1A),
        surfaceVariant = Color(0xFFDCE5E0),
        onSurfaceVariant = Color(0xFF404944),
        outline = Color(0xFF707974),
        outlineVariant = Color(0xFFBFC9C3),
    )

private val DarkColors =
    darkColorScheme(
        primary = Color(0xFF87D6B8),
        onPrimary = Color(0xFF00382A),
        primaryContainer = Color(0xFF00513F),
        onPrimaryContainer = Color(0xFFA3F2D4),
        secondary = Color(0xFFB1CCC0),
        onSecondary = Color(0xFF1C352E),
        secondaryContainer = Color(0xFF334B42),
        onSecondaryContainer = Color(0xFFCDE8DB),
        tertiary = Color(0xFFF0C13E),
        onTertiary = Color(0xFF3E2E00),
        tertiaryContainer = Color(0xFF594400),
        onTertiaryContainer = Color(0xFFFFDF96),
        error = Color(0xFFFFB4AB),
        onError = Color(0xFF690005),
        errorContainer = Color(0xFF93000A),
        onErrorContainer = Color(0xFFFFDAD6),
        background = Color(0xFF0E1512),
        onBackground = Color(0xFFDEE4E0),
        surface = Color(0xFF0E1512),
        onSurface = Color(0xFFDEE4E0),
        surfaceVariant = Color(0xFF404944),
        onSurfaceVariant = Color(0xFFBFC9C3),
        outline = Color(0xFF89938D),
        outlineVariant = Color(0xFF404944),
    )

@Composable
fun TabaaqTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme =
        when {
            dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
                if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            }
            darkTheme -> DarkColors
            else -> LightColors
        }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = TabaaqTypography,
        shapes = TabaaqShapes,
        content = content,
    )
}
