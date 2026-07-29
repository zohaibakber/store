package com.example.data

/**
 * Local bookkeeping for last-write-wins pull merges — `rowVersion` and the
 * timestamps mirror packages/db/src/shared/store.schema.ts. organizationId,
 * deviceId, operationId, and actorUserId deliberately live on the outbox
 * operation ([PendingOperation]) instead of on the row itself: the server
 * computes/owns those per-row (`serverOwnedColumns` in
 * apps/server/src/sync/row-validation.ts), so there's nothing for the client
 * to track on the entity beyond its own version number.
 */
data class SyncMetadata(
    val rowVersion: Long = 0,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val deletedAt: Long? = null,
)
