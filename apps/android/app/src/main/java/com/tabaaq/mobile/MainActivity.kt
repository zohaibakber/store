package com.tabaaq.mobile

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.tabaaq.mobile.ui.navigation.TabaaqApp
import com.tabaaq.mobile.ui.theme.TabaaqTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        super.onCreate(savedInstanceState)
        val container = (application as TabaaqApplication).container
        setContent {
            TabaaqTheme {
                TabaaqApp(container)
            }
        }
    }
}
