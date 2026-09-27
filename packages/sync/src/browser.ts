export { makeSyncEngineFromReplicaStore, SyncEngine } from "./engine";
export type {
  SyncEngineContract,
  SyncEngineError,
  SyncEngineMutex,
  SyncEngineOptions,
  SyncEngineProgress,
} from "./engine";
export { wakeHintsFromSseBody } from "./live-wake";
export type { LiveWakeHost } from "./live-wake";
export { isSnapshotRequired, recoverRequiredSnapshot } from "./recovery";
export type { SnapshotRecoveryError } from "./recovery";
export {
  CAUGHT_UP_RECORD_INTERVAL_MILLIS,
  MAX_REJECTED_ACTIVITY_ROWS,
  shouldRecordCaughtUp,
} from "./replica/activity";
export type {
  OutboxActivityRow,
  OutboxStatusCount,
  ReplicaOutboxActivity,
} from "./replica/activity";
export { DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS } from "./replica/digest-cadence";
export {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  IndexedDbUpgradeBlocked,
  ReplicaCoverageRepairRequired,
  ReplicaStorageError,
  SyncRecoveryRequired,
} from "./replica/errors";
export { IndexedDbReplicaStore } from "./replica/indexeddb/store";
export type {
  DisposableIndexedDbReplicaStore,
  IndexedDbReplicaStoreContract,
} from "./replica/indexeddb/store";
export { ReplicaStore } from "./replica/store";
export type { ReplicaStoreContract, ReplicaStoreError, ReplicaSyncCursor } from "./replica/store";
export { defaultHttpPollPolicy, makeSyncScheduler, SyncScheduler } from "./scheduler";
export type {
  SyncSchedulerContract,
  SyncSchedulerHandlers,
  SyncSchedulerPolicy,
  SyncSchedulerStatus,
  SyncWakeReason,
} from "./scheduler";
export { layerOwnedHttpSync, startOwnedHttpSync } from "./session";
export type { OwnedHttpSync, OwnedHttpSyncOptions } from "./session";
export {
  classifySyncFailure,
  dispositionFor,
  failureFromStatus,
  makeSyncTransport,
  mapSyncFailure,
  retryAfterMillis,
  SyncTransportAuthRequired,
  SyncTransportInvalid,
  SyncTransportOffline,
  SyncTransportService,
  SyncTransportUnavailable,
} from "./transport";
export type {
  SyncCycleFailure,
  SyncFailure,
  SyncFailureDisposition,
  SyncTransport,
  SyncTransportError,
} from "./transport";
export { makeWebNetworkOwnership } from "./web-ownership";
export type { CrossTabNotice, WebNetworkOwnership } from "./web-ownership";
