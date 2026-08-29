package com.tabaaq.mobile.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.tween

/**
 * Material 3 motion. Springs drive in-component physics; these easing curves
 * are for enter / exit / shared-axis transitions (MD3 spec).
 */
object Motion {
    val emphasized: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val emphasizedDecelerate: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val emphasizedAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
    val standard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val standardDecelerate: Easing = CubicBezierEasing(0f, 0f, 0f, 1f)
    val standardAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 1f, 1f)

    const val emphasizedMs = 500
    const val enterMs = 400
    const val exitMs = 200
    const val standardMs = 300
    const val utilityEnterMs = 250
    const val utilityExitMs = 200

    fun <T> enter() = tween<T>(durationMillis = enterMs, easing = emphasizedDecelerate)

    fun <T> exit() = tween<T>(durationMillis = exitMs, easing = emphasizedAccelerate)

    fun <T> emphasized() = tween<T>(durationMillis = emphasizedMs, easing = emphasized)

    fun <T> standard() = tween<T>(durationMillis = standardMs, easing = standard)
}
