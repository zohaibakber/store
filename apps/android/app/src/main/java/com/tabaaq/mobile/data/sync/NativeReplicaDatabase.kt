package com.tabaaq.mobile.data.sync

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.tabaaq.mobile.core.catalog.BatchRow
import com.tabaaq.mobile.core.catalog.CategoryRow
import com.tabaaq.mobile.core.catalog.ProductRow
import com.tabaaq.mobile.core.inventory.ReplicaName
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray

internal class NativeReplicaDatabase private constructor(
    private val helper: Helper,
) : AutoCloseable {
    val database: SQLiteDatabase get() = helper.writableDatabase

    fun cursor(): Long = metadata("cursor")?.toLongOrNull() ?: 0L

    fun pullCursor(): Long = metadata("pull_cursor")?.toLongOrNull() ?: cursor()

    fun epoch(): Int = metadata("epoch")?.toIntOrNull() ?: 2

    fun setCursor(value: Long) = setMetadata("cursor", value.toString())

    fun setPullCursor(value: Long) = setMetadata("pull_cursor", value.toString())

    fun setEpoch(value: Int) = setMetadata("epoch", value.toString())

    fun hasSynced(): Boolean = metadata("has_synced") == "1"

    fun setHasSynced(value: Boolean) = setMetadata("has_synced", if (value) "1" else "0")

    fun outboxCount(): Int = database.rawQuery("SELECT COUNT(*) FROM outbox WHERE state = 'pending'", null).use { it.firstOrNullInt() }

    fun stagedCount(): Int = database.rawQuery("SELECT COUNT(*) FROM staged_changes", null).use { it.firstOrNullInt() }

    fun bootstrapId(): String? = metadata("bootstrap_id")

    fun bootstrapOffset(): Long = metadata("bootstrap_offset")?.toLongOrNull() ?: 0L

    fun setBootstrap(id: String, offset: Long) {
        setMetadata("bootstrap_id", id)
        setMetadata("bootstrap_offset", offset.toString())
    }

    fun clearBootstrap() {
        database.delete("metadata", "key IN ('bootstrap_id','bootstrap_offset')", null)
    }

    fun clearReplicaPreservingOutbox() {
        database.beginTransaction()
        try {
            database.delete("replica_rows", null, null)
            database.delete("staged_changes", null, null)
            database.delete("bootstrap_rows", null, null)
            setCursor(0)
            setPullCursor(0)
            setHasSynced(false)
            clearBootstrap()
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    fun stageChange(change: SyncChange) {
        val values = ContentValues().apply {
            put("entity", change.entity)
            put("entity_id", change.entityId)
            put("row_version", change.rowVersion)
            put("action", change.action)
            put("row_json", change.row?.toString())
        }
        database.insertOrThrow("staged_changes", null, values)
    }

    fun stageBootstrap(change: SyncChange) {
        val values = ContentValues().apply {
            put("entity", change.entity)
            put("entity_id", change.entityId)
            put("row_version", change.rowVersion)
            put("action", change.action)
            put("row_json", change.row?.toString())
        }
        database.insertWithOnConflict("bootstrap_rows", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

        fun applyStagedChanges() {
        database.beginTransaction()
        try {
            database.rawQuery("SELECT entity, entity_id, row_version, action, row_json FROM staged_changes ORDER BY seq", null).use { rows ->
                while (rows.moveToNext()) {
                    applyChange(
                        SyncChange(
                            entity = rows.getString(0),
                            entityId = rows.getString(1),
                            rowVersion = rows.getLong(2),
                            action = rows.getString(3),
                            row = rows.getString(4)?.let { json.parseToJsonElement(it) },
                        ),
                    )
                }
            }
            database.delete("staged_changes", null, null)
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

        fun activateBootstrap(slices: Set<String>) {
        database.beginTransaction()
        try {
            val entities = if (slices.contains("sales")) {
                setOf("category", "product", "batch", "invoice", "invoiceItem", "stockMovement")
            } else {
                setOf("category", "product", "batch")
            }
            entities.forEach { entity -> database.delete("replica_rows", "entity = ?", arrayOf(entity)) }
            database.rawQuery("SELECT entity, entity_id, row_version, action, row_json FROM bootstrap_rows", null).use { rows ->
                while (rows.moveToNext()) {
                    applyChange(
                        SyncChange(
                            entity = rows.getString(0),
                            entityId = rows.getString(1),
                            rowVersion = rows.getLong(2),
                            action = rows.getString(3),
                            row = rows.getString(4)?.let { json.parseToJsonElement(it) },
                        ),
                    )
                }
            }
            database.delete("bootstrap_rows", null, null)
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    fun applyChange(change: SyncChange) {
        if (change.action == "delete" || change.row == null || change.row is JsonNull) {
            val values = ContentValues().apply {
                put("row_version", change.rowVersion)
                put("deleted_at", System.currentTimeMillis())
            }
            database.update("replica_rows", values, "entity = ? AND entity_id = ?", arrayOf(change.entity, change.entityId))
            return
        }
        val values = ContentValues().apply {
            put("entity", change.entity)
            put("entity_id", change.entityId)
            put("row_version", change.rowVersion)
            put("deleted_at", null as Long?)
            put("row_json", change.row.toString())
        }
        database.insertWithOnConflict("replica_rows", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun enqueue(command: String, operationId: String) {
        val values = ContentValues().apply {
            put("operation_id", operationId)
            put("command_json", command)
            put("state", "pending")
            put("error", null as String?)
        }
        database.insertOrThrow("outbox", null, values)
    }

    fun pendingCommands(limit: Int = 50, maxBytes: Int = 256 * 1024): List<OutboxEntry> {
        val result = mutableListOf<OutboxEntry>()
        var bytes = 15
        database.rawQuery("SELECT seq, operation_id, command_json FROM outbox WHERE state = 'pending' ORDER BY seq LIMIT ?", arrayOf(limit.toString())).use { rows ->
            while (rows.moveToNext()) {
                val command = rows.getString(2)
                if (result.isNotEmpty() && bytes + command.toByteArray(Charsets.UTF_8).size + 40 > maxBytes) break
                result += OutboxEntry(rows.getLong(0), rows.getString(1), command)
                bytes += command.toByteArray(Charsets.UTF_8).size + 40
            }
        }
        return result
    }

    fun markAccepted(operationId: String, cursor: Long) {
        val values = ContentValues().apply { put("state", "accepted"); put("ack_cursor", cursor) }
        database.update("outbox", values, "operation_id = ?", arrayOf(operationId))
        removeAcknowledged()
    }

    fun removeAcknowledged() = database.delete("outbox", "state = 'accepted' AND ack_cursor <= ?", arrayOf(cursor().toString()))

    fun <T> transaction(block: () -> T): T {
        database.beginTransaction()
        try {
            val result = block()
            database.setTransactionSuccessful()
            return result
        } finally { database.endTransaction() }
    }


    fun markRejected(operationId: String, error: String) = setOutboxState(operationId, "rejected", error)

    fun removeReplicatedOperations(operationIds: Set<String>) {
        if (operationIds.isEmpty()) return
        database.beginTransaction()
        try {
            operationIds.forEach { database.delete("outbox", "operation_id = ?", arrayOf(it)) }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    fun rows(entity: String): List<JsonObject> {
        val visible = linkedMapOf<String, JsonObject>()
        database.rawQuery("SELECT entity_id, row_json FROM replica_rows WHERE entity = ? AND deleted_at IS NULL ORDER BY entity_id", arrayOf(entity)).use { query ->
            while (query.moveToNext()) visible[query.getString(0)] = json.parseToJsonElement(query.getString(1)).jsonObject
        }
        database.rawQuery("SELECT command_json FROM outbox WHERE state IN ('pending','accepted') ORDER BY seq", null).use { query ->
            while (query.moveToNext()) {
                val command = json.parseToJsonElement(query.getString(0)).jsonObject
                if (command["entity"]?.jsonPrimitive?.contentOrNull != entity) continue
                command["rows"]?.jsonArray?.forEach { value ->
                    val row = value.jsonObject
                    val id = row["id"]!!.jsonPrimitive.content
                    if (row["deletedAt"]?.jsonPrimitive?.longOrNull != null) visible.remove(id)
                    else visible[id] = row
                }
            }
        }
        return visible.values.toList()
    }

    fun row(entity: String, id: String): JsonObject? = database.rawQuery(
        "SELECT row_json FROM replica_rows WHERE entity = ? AND entity_id = ? AND deleted_at IS NULL",
        arrayOf(entity, id),
    ).use { query ->
        if (!query.moveToFirst()) null else runCatching { json.parseToJsonElement(query.getString(0)).jsonObject }.getOrNull()
    }

    override fun close() = helper.close()

    private fun setOutboxState(operationId: String, state: String, error: String?) {
        val values = ContentValues().apply {
            put("state", state)
            put("error", error)
        }
        database.update("outbox", values, "operation_id = ?", arrayOf(operationId))
    }

    private fun metadata(key: String): String? = database.rawQuery(
        "SELECT value FROM metadata WHERE key = ?", arrayOf(key),
    ).use { if (it.moveToFirst()) it.getString(0) else null }

    private fun setMetadata(key: String, value: String) {
        val values = ContentValues().apply { put("key", key); put("value", value) }
        database.insertWithOnConflict("metadata", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    private class Helper(
        context: Context,
        file: String,
    ) : SQLiteOpenHelper(context, file, null, 3) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
            db.execSQL("CREATE TABLE replica_rows (entity TEXT NOT NULL, entity_id TEXT NOT NULL, row_version INTEGER NOT NULL, row_json TEXT NOT NULL, deleted_at INTEGER, PRIMARY KEY(entity, entity_id))")
            db.execSQL("CREATE INDEX replica_rows_visible ON replica_rows(entity, deleted_at, entity_id)")
            db.execSQL("CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE, command_json TEXT NOT NULL, state TEXT NOT NULL, error TEXT, ack_cursor INTEGER)")
            db.execSQL("CREATE INDEX outbox_pending ON outbox(state, seq)")
            db.execSQL("CREATE TABLE staged_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL, row_version INTEGER NOT NULL, action TEXT NOT NULL, row_json TEXT)")
            db.execSQL("CREATE TABLE bootstrap_rows (entity TEXT NOT NULL, entity_id TEXT NOT NULL, row_version INTEGER NOT NULL, action TEXT NOT NULL, row_json TEXT, PRIMARY KEY(entity, entity_id))")
            db.execSQL("INSERT INTO metadata(key, value) VALUES ('epoch', '2'), ('cursor', '0'), ('has_synced', '0')")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            if (oldVersion < 3) db.execSQL("ALTER TABLE outbox ADD COLUMN ack_cursor INTEGER")
            if (oldVersion < 2) db.execSQL("ALTER TABLE outbox ADD COLUMN error TEXT")
        }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

        fun open(context: Context, scopeId: String): NativeReplicaDatabase {
            return NativeReplicaDatabase(Helper(context.applicationContext, ReplicaName.databaseFile(scopeId)))
        }

        private fun Cursor.firstOrNullInt(): Int = if (moveToFirst()) getInt(0) else 0

    }
}

internal data class OutboxEntry(val seq: Long, val operationId: String, val command: String)

internal data class SyncChange(
    val entity: String,
    val entityId: String,
    val rowVersion: Long,
    val action: String,
    val row: JsonElement?,
)

private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: String?) = put(key, value?.let(::JsonPrimitive) ?: JsonNull)
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Boolean) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Long) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Int) = put(key, JsonPrimitive(value))
private fun kotlinx.serialization.json.JsonObjectBuilder.put(key: String, value: Long?) = put(key, value?.let(::JsonPrimitive) ?: JsonNull)

private fun JsonElement?.asLongOrNull(): Long? = this?.jsonPrimitive?.longOrNull
