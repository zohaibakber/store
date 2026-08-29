package com.tabaaq.mobile.data.firebase

import android.graphics.Bitmap
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.tabaaq.mobile.core.scan.ProductScanMode
import com.tabaaq.mobile.core.scan.ProductScanResult
import com.tabaaq.mobile.core.scan.ScanNormalize
import kotlinx.coroutines.withTimeout

/**
 * Product label scan through Firebase AI Logic (Gemini Developer API).
 * Matches Expo `firebase/ai` + `GoogleAIBackend`. Does not use a custom model
 * or Firebase Auth.
 */
class FirebaseProductScan {
    suspend fun infer(
        bitmap: Bitmap,
        mode: ProductScanMode,
    ): ProductScanResult =
        withTimeout(25_000) {
            val model =
                Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                    modelName = "gemini-2.5-flash",
                    generationConfig =
                        generationConfig {
                            temperature = 0f
                            responseMimeType = "application/json"
                        },
                )
            val response =
                model.generateContent(
                    content {
                        text(ScanNormalize.promptFor(mode))
                        image(bitmap)
                    },
                )
            val parsed = ScanNormalize.decode(response.text.orEmpty())
            parsed ?: error("The label could not be understood. Try again with a clearer photo.")
        }
}
