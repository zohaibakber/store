package com.example.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Mirrors packages/contracts/src/sync/schema.ts field-for-field so
 * kotlinx.serialization produces the same wire shape the server expects.
 */
@Serializable
data class SyncEntityChange(
    val entity: String, // "category" | "product" | "batch" | "invoice" | "invoiceItem" | "stockMovement"
    val action: String, // "upsert" | "delete"
    val entityId: String,
    val rowVersion: Long,
    val row: JsonElement,
)

@Serializable
data class SyncOperation(
    val operationId: String,
    val organizationId: String,
    val deviceId: String,
    val actorUserId: String,
    val clientSequence: Long,
    val occurredAt: Long,
    val payloadHash: String,
    val changes: List<SyncEntityChange>,
)

/** Same fields as [SyncOperation] minus `payloadHash` — what canonical-json.ts actually hashes. */
@Serializable
data class SyncOperationPayload(
    val operationId: String,
    val organizationId: String,
    val deviceId: String,
    val actorUserId: String,
    val clientSequence: Long,
    val occurredAt: Long,
    val changes: List<SyncEntityChange>,
)

@Serializable
data class SyncRequest(
    val organizationId: String,
    val deviceId: String,
    val cursor: Long,
    val operations: List<SyncOperation>,
)

@Serializable
data class SyncAck(
    val operationId: String,
    val status: String, // "applied" | "duplicate"
    val cursor: Long,
)

@Serializable
data class SyncServerChange(
    val cursor: Long,
    val operationId: String,
    val changedAt: Long,
    val change: SyncEntityChange,
)

@Serializable
data class SyncResponse(
    val organizationId: String,
    val cursor: Long,
    val hasMore: Boolean,
    val acknowledgements: List<SyncAck>,
    val changes: List<SyncServerChange>,
)
