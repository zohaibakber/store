package com.example.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker.Result
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class SyncWorker(
    context: Context,
    params: WorkerParameters,
    private val syncRepository: SyncRepository,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val outcome = syncRepository.syncOnce()
        return if (outcome.isSuccess) Result.success() else Result.retry()
    }

    companion object {
        const val UNIQUE_PERIODIC_NAME = "sync-periodic"
        const val UNIQUE_EXPEDITED_NAME = "sync-expedited"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** Safety-net sync — WorkManager's floor for periodic work is 15 minutes. */
        fun schedulePeriodic(workManager: WorkManager) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build()
            workManager.enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC_NAME,
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** Fired right after a local mutation so a scan feels like it syncs immediately. */
        fun syncNow(workManager: WorkManager) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(networkConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build()
            workManager.enqueueUniqueWork(UNIQUE_EXPEDITED_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancelPeriodic(workManager: WorkManager) {
            workManager.cancelUniqueWork(UNIQUE_PERIODIC_NAME)
        }
    }
}

/** Constructs [SyncWorker] with its [SyncRepository] dependency — see StoreApplication. */
class SyncWorkerFactory(private val syncRepository: SyncRepository) : WorkerFactory() {
    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ) = if (workerClassName == SyncWorker::class.java.name) {
        SyncWorker(appContext, workerParameters, syncRepository)
    } else {
        null
    }
}
