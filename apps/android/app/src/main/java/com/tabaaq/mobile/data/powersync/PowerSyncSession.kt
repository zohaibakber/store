package com.tabaaq.mobile.data.powersync

import android.content.Context
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.powersync.db.getBoolean
import com.powersync.db.getLong
import com.powersync.db.getLongOptional
import com.powersync.db.getString
import com.powersync.db.getStringOptional
import com.tabaaq.mobile.core.catalog.BatchRow
import com.tabaaq.mobile.core.catalog.CatalogMapping
import com.tabaaq.mobile.core.catalog.CatalogSnapshot
import com.tabaaq.mobile.core.catalog.CategoryRow
import com.tabaaq.mobile.core.catalog.ProductRow
import com.tabaaq.mobile.core.inventory.ReplicaName
import com.tabaaq.mobile.data.auth.AuthRepository
import com.tabaaq.mobile.data.config.AppConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

data class SyncUiState(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val downloading: Boolean = false,
    val hasSynced: Boolean? = null,
    val error: String? = null,
)

class PowerSyncSession(
    private val context: Context,
    private val config: AppConfig,
    private val auth: AuthRepository,
    private val connector: InventoryConnector,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var database: PowerSyncDatabase? = null
    private var watchJob: Job? = null

    private val _snapshot = MutableStateFlow(CatalogSnapshot(emptyList(), emptyList()))
    val snapshot: StateFlow<CatalogSnapshot> = _snapshot

    private val _sync = MutableStateFlow(SyncUiState())
    val sync: StateFlow<SyncUiState> = _sync

    suspend fun start(organizationId: String) {
        stop()
        val file = ReplicaName.databaseFile(ReplicaName.scope(config.apiUrl, organizationId))
        val db =
            PowerSyncDatabase(
                factory = DatabaseDriverFactory(context),
                schema = InventorySchema.schema,
                dbFilename = file,
                scope = scope,
            )
        database = db
        db.connect(connector)
        watchJob =
            scope.launch {
                launch {
                    db.currentStatus.asFlow().collect { status ->
                        _sync.value =
                            SyncUiState(
                                connected = status.connected,
                                connecting = status.connecting,
                                downloading = status.downloading,
                                hasSynced = status.hasSynced,
                                error = status.anyError?.toString(),
                            )
                    }
                }
                combine(
                    db.watch("SELECT * FROM products WHERE deletedAt IS NULL") { cursor ->
                        ProductRow(
                            id = cursor.getString("id"),
                            name = cursor.getString("name"),
                            categoryId = cursor.getString("categoryId"),
                            aisle = cursor.getStringOptional("aisle"),
                            composition = cursor.getStringOptional("composition"),
                            strength = cursor.getStringOptional("strength"),
                            unitsPerPack = cursor.getLong("unitsPerPack"),
                            packPrice = cursor.getLongOptional("packPrice"),
                            unitPrice = cursor.getLongOptional("unitPrice"),
                            visible = cursor.getBoolean("visible"),
                            organizationId = cursor.getString("organizationId"),
                            createdByUserId = cursor.getString("createdByUserId"),
                            updatedByUserId = cursor.getString("updatedByUserId"),
                            deviceId = cursor.getString("deviceId"),
                            operationId = cursor.getString("operationId"),
                            rowVersion = cursor.getLong("rowVersion"),
                            createdAt = cursor.getLong("createdAt"),
                            updatedAt = cursor.getLong("updatedAt"),
                            deletedAt = cursor.getLongOptional("deletedAt"),
                        )
                    },
                    db.watch("SELECT * FROM categories WHERE deletedAt IS NULL") { cursor ->
                        CategoryRow(
                            id = cursor.getString("id"),
                            name = cursor.getString("name"),
                            tracksPacks = cursor.getBoolean("tracksPacks"),
                            organizationId = cursor.getString("organizationId"),
                            createdByUserId = cursor.getString("createdByUserId"),
                            updatedByUserId = cursor.getString("updatedByUserId"),
                            deviceId = cursor.getString("deviceId"),
                            operationId = cursor.getString("operationId"),
                            rowVersion = cursor.getLong("rowVersion"),
                            createdAt = cursor.getLong("createdAt"),
                            updatedAt = cursor.getLong("updatedAt"),
                            deletedAt = cursor.getLongOptional("deletedAt"),
                        )
                    },
                    db.watch("SELECT * FROM batches WHERE deletedAt IS NULL") { cursor ->
                        BatchRow(
                            id = cursor.getString("id"),
                            productId = cursor.getString("productId"),
                            batchNumber = cursor.getStringOptional("batchNumber"),
                            expiresAt = cursor.getLongOptional("expiresAt"),
                            packQuantity = cursor.getLong("packQuantity"),
                            unitQuantity = cursor.getLong("unitQuantity"),
                            organizationId = cursor.getString("organizationId"),
                            createdByUserId = cursor.getString("createdByUserId"),
                            updatedByUserId = cursor.getString("updatedByUserId"),
                            deviceId = cursor.getString("deviceId"),
                            operationId = cursor.getString("operationId"),
                            rowVersion = cursor.getLong("rowVersion"),
                            createdAt = cursor.getLong("createdAt"),
                            updatedAt = cursor.getLong("updatedAt"),
                            deletedAt = cursor.getLongOptional("deletedAt"),
                        )
                    },
                ) { products, categories, batches ->
                    CatalogMapping.snapshotFromRows(products, categories, batches)
                }.collect { _snapshot.value = it }
            }
    }

    suspend fun stop() {
        watchJob?.cancel()
        watchJob = null
        val db = database
        database = null
        _snapshot.value = CatalogSnapshot(emptyList(), emptyList())
        _sync.value = SyncUiState()
        if (db != null) {
            runCatching { db.disconnectAndClear() }
            runCatching { db.close() }
        }
    }
}
