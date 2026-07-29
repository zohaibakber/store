package com.example.ml

import com.example.BuildConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Query
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

@Serializable
data class GenerateContentRequest(
    val contents: List<Content>,
    val generationConfig: GenerationConfig? = null,
    val systemInstruction: Content? = null
)

@Serializable
data class Content(
    val parts: List<Part>
)

@Serializable
data class Part(
    val text: String
)

@Serializable
data class GenerationConfig(
    val responseFormat: ResponseFormat? = null,
    val temperature: Float? = null
)

@Serializable
data class ResponseFormat(
    val text: ResponseFormatText? = null
)

@Serializable
data class ResponseFormatText(
    val mimeType: String,
    val schema: JsonObject? = null
)

@Serializable
data class GenerateContentResponse(
    val candidates: List<Candidate>
)

@Serializable
data class Candidate(
    val content: Content
)

interface GeminiApiService {
    @POST("v1beta/models/gemini-3.5-flash:generateContent")
    suspend fun generateContent(
        @Query("key") apiKey: String,
        @Body request: GenerateContentRequest
    ): GenerateContentResponse
}

object RetrofitClient {
    private const val BASE_URL = "https://generativelanguage.googleapis.com/"

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    val service: GeminiApiService by lazy {
        val json = Json { ignoreUnknownKeys = true }
        val retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
        retrofit.create(GeminiApiService::class.java)
    }
}

data class ParsedMedicine(
    val name: String,
    val composition: String,
    val batchNumber: String,
    val expiryDate: String,
    val category: String,
    val quantity: Int
)

class GeminiParsingService {
    suspend fun parseMedicineInfo(extractedText: String): ParsedMedicine? = withContext(Dispatchers.IO) {
        val apiKey = BuildConfig.GEMINI_API_KEY
        if (apiKey.isEmpty() || apiKey == "MY_GEMINI_API_KEY") {
            return@withContext null
        }

        val schema = buildJsonObject {
            put("type", "OBJECT")
            putJsonObject("properties") {
                putJsonObject("name") {
                    put("type", "STRING")
                    put("description", "The brand name or common name of the medicine.")
                }
                putJsonObject("composition") {
                    put("type", "STRING")
                    put("description", "The active ingredients or composition of the medicine.")
                }
                putJsonObject("batchNumber") {
                    put("type", "STRING")
                    put("description", "The batch number or lot number (e.g. B.No, Lot).")
                }
                putJsonObject("expiryDate") {
                    put("type", "STRING")
                    put("description", "The expiry date of the medicine (e.g. Exp Date, Expiry).")
                }
                putJsonObject("category") {
                    put("type", "STRING")
                    put("description", "The category of the medicine (e.g. Antibiotic, Painkiller, Vitamin, General). Default to 'General' if unsure.")
                }
                putJsonObject("quantity") {
                    put("type", "INTEGER")
                    put("description", "The quantity or number of units (e.g. tablets, capsules) in the package. Default to 1 if unsure.")
                }
            }
        }

        val request = GenerateContentRequest(
            contents = listOf(Content(
                parts = listOf(Part(text = "Extract medicine details from the following raw OCR text:\n$extractedText\n\nIf a field is not found, leave it empty. For quantity, look for things like '10 tablets', '50ml', etc. and extract the number. Default category to General and quantity to 1 if not found."))
            )),
            generationConfig = GenerationConfig(
                responseFormat = ResponseFormat(
                    text = ResponseFormatText(
                        mimeType = "application/json",
                        schema = schema
                    )
                ),
                temperature = 0.1f
            ),
            systemInstruction = Content(
                parts = listOf(Part(text = "You are an expert at extracting structured information from raw OCR text on medicine packaging."))
            )
        )

        try {
            val response = RetrofitClient.service.generateContent(apiKey, request)
            val jsonString = response.candidates.firstOrNull()?.content?.parts?.firstOrNull()?.text ?: return@withContext null
            
            val json = Json.parseToJsonElement(jsonString).jsonObject
            val name = json["name"]?.jsonPrimitive?.content ?: ""
            val composition = json["composition"]?.jsonPrimitive?.content ?: ""
            val batchNumber = json["batchNumber"]?.jsonPrimitive?.content ?: ""
            val expiryDate = json["expiryDate"]?.jsonPrimitive?.content ?: ""
            val category = json["category"]?.jsonPrimitive?.content ?: "General"
            val quantity = json["quantity"]?.jsonPrimitive?.content?.toIntOrNull() ?: 1
            
            ParsedMedicine(name, composition, batchNumber, expiryDate, category, quantity)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
