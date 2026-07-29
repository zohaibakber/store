package com.example.ml

import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Field names mirror `products`/`batches` in
// packages/db/src/shared/store.schema.ts (name, composition, strength,
// batchNumber, expiresAt, category, unitQuantity).
data class ParsedProduct(
    val name: String,
    val composition: String,
    val strength: String,
    val batchNumber: String,
    val expiryDate: String,
    val category: String,
    val unitQuantity: Int,
)

/**
 * Parses OCR text via the Firebase AI Logic SDK (cloud Gemini). Structured
 * JSON output (`responseSchema`) is explicitly unsupported on Gemini Nano's
 * on-device path as of this writing — Firebase's own hybrid-inference docs
 * say to use the cloud backend whenever you need it — so this deliberately
 * does not attempt on-device inference; it would silently fail to produce
 * the structured fields this app actually needs.
 *
 * Requires a Firebase project wired into this app (a real
 * `google-services.json` in app/, not present in this repo — see
 * apps/android/AGENTS.md) with the Gemini Developer API enabled in the
 * Firebase console. Without that, `Firebase.ai(...)` throws at call time.
 */
private val productResponseSchema = Schema.obj(
    mapOf(
        "name" to Schema.string(description = "The brand name or common name of the product."),
        "composition" to Schema.string(description = "The active ingredients or composition of the product, if any."),
        "strength" to Schema.string(description = "The dosage strength (e.g. 500mg, 10mg), if any."),
        "batchNumber" to Schema.string(description = "The batch number or lot number (e.g. B.No, Lot)."),
        "expiryDate" to Schema.string(description = "The expiry date of the product (e.g. Exp Date, Expiry), formatted MM/yy."),
        "category" to Schema.string(description = "One of: medicine, cosmetics, general. Default to 'general' if unsure."),
        "unitQuantity" to Schema.integer(description = "The quantity or number of units (e.g. tablets, capsules) in the package. Default to 1 if unsure."),
    ),
)

private const val SYSTEM_INSTRUCTION =
    "You are an expert at extracting structured information from raw OCR text on product packaging for a shop that sells medicines and general goods."

class GeminiParsingService {
    private val model by lazy {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = "gemini-3.6-flash",
            generationConfig = generationConfig {
                responseMimeType = "application/json"
                responseSchema = productResponseSchema
                temperature = 0.1f
            },
            systemInstruction = content { text(SYSTEM_INSTRUCTION) },
        )
    }

    suspend fun parseProductInfo(extractedText: String): ParsedProduct? = withContext(Dispatchers.IO) {
        try {
            val prompt = "Extract product details from the following raw OCR text:\n$extractedText\n\n" +
                "If a field is not found, leave it empty. For unitQuantity, look for things like " +
                "'10 tablets', '50ml', etc. and extract the number. Default category to general and " +
                "unitQuantity to 1 if not found."

            val response = model.generateContent(prompt)
            val jsonString = response.text ?: return@withContext null

            val json = Json.parseToJsonElement(jsonString).jsonObject
            ParsedProduct(
                name = json["name"]?.jsonPrimitive?.content ?: "",
                composition = json["composition"]?.jsonPrimitive?.content ?: "",
                strength = json["strength"]?.jsonPrimitive?.content ?: "",
                batchNumber = json["batchNumber"]?.jsonPrimitive?.content ?: "",
                expiryDate = json["expiryDate"]?.jsonPrimitive?.content ?: "",
                category = json["category"]?.jsonPrimitive?.content ?: "general",
                unitQuantity = json["unitQuantity"]?.jsonPrimitive?.content?.toIntOrNull() ?: 1,
            )
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
