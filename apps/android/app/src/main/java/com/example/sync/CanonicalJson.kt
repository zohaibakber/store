package com.example.sync

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.security.MessageDigest

/**
 * A from-scratch canonical-JSON encoder — mirrors
 * packages/contracts/src/sync/canonical-json.ts exactly: object keys sorted
 * by UTF-16 code unit order (Kotlin's default `String` comparison is also
 * code-unit order, same as JS `<`), no extra whitespace anywhere. This does
 * NOT delegate to kotlinx.serialization's own `Json.encodeToString` for the
 * final stringify step — hand-writing the separators removes any doubt about
 * matching `JSON.stringify`'s exact output byte-for-byte, which is what the
 * payload hash below actually has to match.
 *
 * Getting this wrong means every sync operation gets rejected server-side
 * with PAYLOAD_HASH_MISMATCH/INVALID_PAYLOAD_HASH — see CanonicalJsonTest,
 * a golden-fixture check against the real TypeScript `operationPayloadHash`.
 */
object CanonicalJson {
    fun canonicalize(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> buildJsonObject {
            element.entries.sortedBy { it.key }.forEach { (key, value) -> put(key, canonicalize(value)) }
        }
        is JsonArray -> JsonArray(element.map(::canonicalize))
        is JsonPrimitive -> element
    }

    fun stringify(element: JsonElement): String = encode(canonicalize(element))

    private fun encode(element: JsonElement): String = when (element) {
        is JsonObject -> element.entries.joinToString(",", "{", "}") { (key, value) ->
            "${encodeString(key)}:${encode(value)}"
        }
        is JsonArray -> element.joinToString(",", "[", "]", transform = ::encode)
        is JsonPrimitive -> if (element.isString) encodeString(element.content) else element.content
    }

    private fun encodeString(value: String): String {
        val builder = StringBuilder(value.length + 2).append('"')
        for (char in value) {
            when (char) {
                '"' -> builder.append("\\\"")
                '\\' -> builder.append("\\\\")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                '\b' -> builder.append("\\b")
                '\u000C' -> builder.append("\\f")
                else -> if (char.code < 0x20) {
                    builder.append("\\u").append(char.code.toString(16).padStart(4, '0'))
                } else {
                    builder.append(char)
                }
            }
        }
        return builder.append('"').toString()
    }

    fun sha256Hex(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
