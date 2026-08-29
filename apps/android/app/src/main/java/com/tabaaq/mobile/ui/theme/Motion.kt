package com.tabaaq.mobile.ui.theme

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween

/**
 * Public-API counterpart to Material 3's spatial/effects motion categories.
 * Material3 1.4.0 does not yet expose MotionScheme publicly.
 */
object AppMotion {
    fun <T> defaultSpatial() =
        spring<T>(
            dampingRatio = 0.82f,
            stiffness = Spring.StiffnessMediumLow,
        )

    fun <T> fastSpatial() =
        spring<T>(
            dampingRatio = Spring.DampingRatioNoBouncy,
            stiffness = Spring.StiffnessMedium,
        )

    fun <T> defaultEffects() = tween<T>(durationMillis = 220, easing = FastOutSlowInEasing)

    fun <T> fastEffects() = tween<T>(durationMillis = 150, easing = FastOutSlowInEasing)
}
