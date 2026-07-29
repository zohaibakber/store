package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** One entry of a [PendingOperation]'s `changesJson` — shaped like the server's `SyncEntityChange`. */
@Serializable
data class PendingChange(
    val entity: String, // "category" | "product" | "batch"
    val action: String, // "upsert" | "delete"
    val entityId: String,
    val rowVersion: Long,
    val rowJson: String,
)

/**
 * The local outbox: one row per not-yet-acknowledged [com.example.sync.SyncOperation].
 * Mirrors the client-side pattern already implemented for desktop in
 * packages/persistence/src/sync/outbox.ts. `changesJson` is a JSON-encoded
 * `List<PendingChange>` rather than a Room relation — it's write-once,
 * read-whole, so there's no need for a normalized child table.
 */
@Entity(tableName = "pending_operations")
data class PendingOperation(
    @PrimaryKey val operationId: String,
    val organizationId: String,
    val deviceId: String,
    val actorUserId: String,
    val clientSequence: Long,
    val occurredAt: Long,
    val changesJson: String,
) {
    companion object {
        fun encodeChanges(changes: List<PendingChange>): String = Json.encodeToString(changes)
        fun decodeChanges(changesJson: String): List<PendingChange> = Json.decodeFromString(changesJson)
    }
}
