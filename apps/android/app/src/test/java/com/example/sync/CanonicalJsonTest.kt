package com.example.sync

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Golden-fixture check: the expected hash below was produced by running the
 * *real* TypeScript `operationPayloadHash`
 * (packages/contracts/src/sync/operation-hash.ts) against this exact
 * operation shape — not derived from this Kotlin code. If
 * [CanonicalJson] ever mismatches this, every sync operation gets rejected
 * server-side with PAYLOAD_HASH_MISMATCH regardless of anything else being
 * correct — this test is what would catch that before a real device does.
 *
 * To regenerate after an intentional change: run the TS function against the
 * same fixture (see the one-off script used to produce this value) and
 * update the expected hash, never the other way around.
 */
class CanonicalJsonTest {
    @Test
    fun `matches the TypeScript canonical-json hash for a fixed operation`() {
        val operation = buildJsonObject {
            put("operationId", "op_fixture_0001")
            put("organizationId", "org_fixture_0001")
            put("deviceId", "device_fixture_0001")
            put("actorUserId", "user_fixture_0001")
            put("clientSequence", 1)
            put("occurredAt", 1_753_000_000_000L)
            putJsonArray("changes") {
                addJsonObject {
                    put("entity", "product")
                    put("action", "upsert")
                    put("entityId", "product_fixture_0001")
                    put("rowVersion", 1)
                    putJsonObject("row") {
                        put("id", "product_fixture_0001")
                        put("name", "Amoxicillin")
                        put("categoryId", "general")
                        put("composition", "Amoxicillin Trihydrate")
                        put("strength", "500mg")
                        put("unitsPerPack", 1)
                        put("packPrice", JsonNull)
                        put("unitPrice", JsonNull)
                        put("visible", true)
                    }
                }
                addJsonObject {
                    put("entity", "batch")
                    put("action", "upsert")
                    put("entityId", "batch_fixture_0001")
                    put("rowVersion", 1)
                    putJsonObject("row") {
                        put("id", "batch_fixture_0001")
                        put("productId", "product_fixture_0001")
                        put("batchNumber", "AX-9283-L")
                        put("expiresAt", 1_798_761_600_000L)
                        put("packQuantity", 0)
                        put("unitQuantity", 50)
                    }
                }
            }
        }

        val hash = CanonicalJson.sha256Hex(CanonicalJson.stringify(operation))

        assertEquals("bba04e892c7538ff8865623dc4ed51835d6c658e55f4f6ebea3a9b91a431480c", hash)
    }
}
