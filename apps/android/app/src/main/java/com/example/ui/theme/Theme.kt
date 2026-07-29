package com.example.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// Mirrors apps/desktop/src/styles.css :root / .dark tokens — a monochrome
// neutral scheme rather than Material's default purple, so the two apps read
// as one product.
private val LightColorScheme = lightColorScheme(
    background = Color.White,
    surface = Color.White,
    onBackground = Neutral800,
    onSurface = Neutral800,
    primary = Neutral800,
    onPrimary = Neutral50,
    secondary = Neutral100,
    onSecondary = Neutral800,
    error = Red500,
    onError = Red700,
    outline = Neutral400,
)

private val DarkColorScheme = darkColorScheme(
    background = Neutral950,
    surface = Neutral950,
    onBackground = Neutral100,
    onSurface = Neutral100,
    primary = Neutral100,
    onPrimary = Neutral800,
    secondary = Neutral800,
    onSecondary = Neutral100,
    error = Red400,
    onError = Red700,
    outline = Neutral500,
)

// --radius: 0.625rem == 10dp; --radius-sm/lg/xl follow the same ratio as the
// desktop @theme block.
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(14.dp),
    extraLarge = RoundedCornerShape(18.dp),
)

val LocalSemanticColors = staticCompositionLocalOf { LightSemanticColors }

@Composable
fun MyApplicationTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val semanticColors = if (darkTheme) DarkSemanticColors else LightSemanticColors

    CompositionLocalProvider(LocalSemanticColors provides semanticColors) {
        MaterialTheme(colorScheme = colorScheme, typography = Typography, shapes = AppShapes, content = content)
    }
}
