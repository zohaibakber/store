package com.example

import android.app.Application
import androidx.work.Configuration
import androidx.work.WorkManager
import com.example.auth.AuthRepository
import com.example.auth.CredentialAuthManager
import com.example.auth.SessionStore
import com.example.data.ProductDatabase
import com.example.data.ProductRepository
import com.example.network.NetworkModule
import com.example.sync.SyncRepository
import com.example.sync.SyncWorker
import com.example.sync.SyncWorkerFactory

/**
 * Builds the app's singletons once, application-wide — MainActivity reads
 * them from here rather than constructing its own, so there's a single
 * Room/DataStore instance regardless of how many Activities exist.
 *
 * Implementing [Configuration.Provider] here is also what tells WorkManager
 * to skip its default auto-init and defer to [workManagerConfiguration]
 * instead, so [com.example.sync.SyncWorker] can be constructed with its
 * [SyncRepository] dependency — no manifest changes needed for this, just
 * this interface.
 */
class StoreApplication : Application(), Configuration.Provider {
    lateinit var sessionStore: SessionStore
        private set
    lateinit var authRepository: AuthRepository
        private set
    lateinit var credentialAuthManager: CredentialAuthManager
        private set
    lateinit var productRepository: ProductRepository
        private set
    lateinit var syncRepository: SyncRepository
        private set

    override fun onCreate() {
        super.onCreate()

        sessionStore = SessionStore(this)
        val networkModule = NetworkModule(sessionStore)
        authRepository = AuthRepository(networkModule.storeApi, sessionStore)
        credentialAuthManager = CredentialAuthManager(this)

        val database = ProductDatabase.getDatabase(this)
        syncRepository = SyncRepository(networkModule.storeApi, database.productDao(), sessionStore)
        productRepository = ProductRepository(database.productDao(), sessionStore, WorkManager.getInstance(this))

        SyncWorker.schedulePeriodic(WorkManager.getInstance(this))
    }

    override fun getWorkManagerConfiguration(): Configuration =
        Configuration.Builder()
            .setWorkerFactory(SyncWorkerFactory(syncRepository))
            .build()
}
