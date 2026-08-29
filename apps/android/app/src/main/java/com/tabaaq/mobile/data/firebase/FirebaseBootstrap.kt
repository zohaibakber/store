package com.tabaaq.mobile.data.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * Same public Firebase web project Expo uses for Gemini (`tabaaq-67ffc`).
 * These values are client config, not secrets. google-services.json still
 * wins when present (Play / App Check later).
 */
object FirebaseBootstrap {
    fun start(context: Context) {
        if (FirebaseApp.getApps(context).isNotEmpty()) return
        val options =
            FirebaseOptions.Builder()
                .setProjectId(PROJECT_ID)
                .setApplicationId(APP_ID)
                .setApiKey(API_KEY)
                .setStorageBucket(STORAGE_BUCKET)
                .setGcmSenderId(SENDER_ID)
                .build()
        FirebaseApp.initializeApp(context, options)
    }

    const val PROJECT_ID = "tabaaq-67ffc"
    private const val APP_ID = "1:353317807467:web:b90fd5e9bf82bbc013582e"
    private const val API_KEY = "AIzaSyCP7-0jxnql6bTu4TZsh6F3MSt_598u2iw"
    private const val STORAGE_BUCKET = "tabaaq-67ffc.firebasestorage.app"
    private const val SENDER_ID = "353317807467"
}
