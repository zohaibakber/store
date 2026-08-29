package com.tabaaq.mobile.core.catalog

data class CatalogActor(
    val organizationId: String,
    val userId: String,
    val deviceId: String,
)

data class MutationMetadata(
    val organizationId: String? = null,
    val createdByUserId: String? = null,
    val updatedByUserId: String,
    val deviceId: String,
    val operationId: String,
    val rowVersion: Long,
    val createdAt: Long? = null,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

object MutationIds {
    fun now(): Long = System.currentTimeMillis()

    fun operationId(): String = java.util.UUID.randomUUID().toString()

    fun rowId(): String = java.util.UUID.randomUUID().toString()
}

fun createdMetadata(
    actor: CatalogActor,
    now: Long = MutationIds.now(),
    operationId: String = MutationIds.operationId(),
) = MutationMetadata(
    organizationId = actor.organizationId,
    createdByUserId = actor.userId,
    updatedByUserId = actor.userId,
    deviceId = actor.deviceId,
    operationId = operationId,
    rowVersion = 1,
    createdAt = now,
    updatedAt = now,
    deletedAt = null,
)

fun updatedMetadata(
    actor: CatalogActor,
    rowVersion: Long,
    now: Long = MutationIds.now(),
    operationId: String = MutationIds.operationId(),
) = MutationMetadata(
    updatedByUserId = actor.userId,
    deviceId = actor.deviceId,
    operationId = operationId,
    rowVersion = rowVersion + 1,
    updatedAt = now,
)
