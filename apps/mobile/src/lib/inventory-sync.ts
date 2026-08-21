import { SyncRequest, SyncResponse } from "@store/contracts";
import {
  connectSyncSocketSession,
  makeSyncSocketSession,
  SyncTransportError,
} from "@store/sync-client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

import { apiOrigin, getAccessToken } from "@/lib/auth-client";
import { persistentDeviceId } from "@/lib/inventory-session";
import { snapshotFromMaps } from "@/lib/inventory-snapshot";
import type {
  InventorySnapshot,
  InventoryState,
  JsonObject,
  JsonValue,
  StoredMutationState,
  SyncEntityChange,
  SyncOperation,
} from "@/lib/inventory-types";
import { isLocalUserId } from "@/lib/local-session";
import { reattributePendingOperations } from "@/lib/mobile-sync-queue";
import {
  applyProductSyncChanges,
  assertSyncProgress,
  restoreProductSyncState,
  serializeProductSyncState,
} from "@/lib/product-sync-state";
import { openMobileSyncSocket } from "@/lib/sync-socket";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SYNC_PAGES = 1_000;
const MAX_CHANGES_PER_REQUEST = 1_000;
const CACHE_KEY_PREFIX = "tabaaq-product-sync-v1";
const MUTATION_KEY_PREFIX = "tabaaq-product-mutations-v1";

/** Session + locks owned by an opened InventoryWorkspace. */
export type InventoryAccess = {
  readonly userId: string;
  readonly organizationId: string;
  readonly withLock: <T>(work: () => Promise<T>) => Promise<T>;
  readonly withSyncLock: <T>(work: () => Promise<T>) => Promise<T>;
};

interface SyncOperationCandidate {
  readonly operationId?: unknown;
  readonly organizationId?: unknown;
  readonly deviceId?: unknown;
  readonly actorUserId?: unknown;
  readonly clientSequence?: unknown;
  readonly occurredAt?: unknown;
  readonly payloadHash?: unknown;
  readonly changes?: unknown;
}

const hasSyncOperationFields = <Value>(value: Value): value is Value & SyncOperationCandidate =>
  typeof value === "object" && value !== null;

const isSyncOperation = <Value>(value: Value): value is Value & SyncOperation => {
  if (!hasSyncOperationFields(value)) return false;
  return (
    typeof value.operationId === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.deviceId === "string" &&
    typeof value.actorUserId === "string" &&
    Number.isSafeInteger(value.clientSequence) &&
    Number(value.clientSequence) >= 1 &&
    Number.isSafeInteger(value.occurredAt) &&
    typeof value.payloadHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.payloadHash) &&
    Array.isArray(value.changes) &&
    value.changes.length > 0
  );
};

const mutationKey = (organizationId: string) => `${MUTATION_KEY_PREFIX}:${organizationId}`;

const restoreMutationState = (
  serialized: string | null,
  organizationId: string,
): StoredMutationState | null => {
  if (!serialized) return null;
  let value: Partial<StoredMutationState>;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("The local inventory mutation queue is damaged.");
  }
  if (
    value.version !== 1 ||
    value.organizationId !== organizationId ||
    !Schema.is(Schema.String)(value.deviceId) ||
    !value.deviceId ||
    !Number.isSafeInteger(value.nextClientSequence) ||
    Number(value.nextClientSequence) < 1 ||
    !Array.isArray(value.pendingOperations) ||
    !value.pendingOperations.every(isSyncOperation) ||
    value.pendingOperations.some(
      (operation) =>
        operation.organizationId !== organizationId || operation.deviceId !== value.deviceId,
    )
  ) {
    throw new Error("The local inventory mutation queue is damaged.");
  }
  // SAFETY: All stored mutation fields and every queued operation were validated above.
  return value as StoredMutationState;
};

const persistMutationState = (state: StoredMutationState) =>
  Storage.setItem(mutationKey(state.organizationId), JSON.stringify(state));

const isJsonObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
};

const payloadHash = (operation: Omit<SyncOperation, "payloadHash">) => {
  const jsonValue: JsonValue = JSON.parse(JSON.stringify(operation));
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(canonicalizeJson(jsonValue)),
  );
};

const requestPage = (
  exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>,
  organizationId: string,
  id: string,
  cursor: number,
  operations: ReadonlyArray<SyncOperation>,
) =>
  exchange({
    protocolVersion: 2,
    organizationId,
    deviceId: id,
    clientPlatform: "mobile",
    clientVersion: Constants.expoConfig?.version ?? "0.3.14",
    cursor,
    operations,
  });

const selectPendingOperations = (pending: ReadonlyArray<SyncOperation>) => {
  const selected: SyncOperation[] = [];
  let changeCount = 0;
  for (const operation of pending) {
    // Send one mutation at a time so a conflict can be attributed without
    // discarding unrelated queued work.
    if (selected.length >= 1) break;
    if (operation.changes.length > MAX_CHANGES_PER_REQUEST)
      throw new Error("A queued inventory change is too large to synchronize.");
    if (selected.length > 0 && changeCount + operation.changes.length > MAX_CHANGES_PER_REQUEST)
      break;
    selected.push(operation);
    changeCount += operation.changes.length;
  }
  return selected;
};

const isStockAdjustment = (operation: SyncOperation) =>
  operation.changes.some(
    (change) =>
      change.entity === "stockMovement" && "type" in change.row && change.row.type === "adjustment",
  );

const loadInventoryState = async (organizationId: string): Promise<InventoryState> => {
  const cacheKey = `${CACHE_KEY_PREFIX}:${organizationId}`;
  const restored = restoreProductSyncState(await Storage.getItem(cacheKey), organizationId);
  return {
    organizationId,
    cacheKey,
    cursor: restored.cursor,
    maps: restored.maps,
    mutationState: restoreMutationState(
      await Storage.getItem(mutationKey(organizationId)),
      organizationId,
    ),
  };
};

const rotateDeviceAfterSequenceReuse = async (access: InventoryAccess) => {
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync("tabaaq-device-id", created);
  await access.withLock(async () => {
    const state = await loadInventoryState(access.organizationId);
    if (!state.mutationState) return;
    let nextSequence = 1;
    const pendingOperations: SyncOperation[] = [];
    for (const operation of state.mutationState.pendingOperations) {
      const unhashed = {
        operationId: operation.operationId,
        organizationId: operation.organizationId,
        deviceId: created,
        actorUserId: operation.actorUserId,
        clientSequence: nextSequence,
        occurredAt: operation.occurredAt,
        changes: operation.changes,
      } satisfies Omit<SyncOperation, "payloadHash">;
      nextSequence += 1;
      pendingOperations.push({ ...unhashed, payloadHash: await payloadHash(unhashed) });
    }
    state.mutationState = {
      version: 1,
      organizationId: access.organizationId,
      deviceId: created,
      nextClientSequence: nextSequence,
      pendingOperations,
    };
    await persistMutationState(state.mutationState);
  });
  return created;
};

const exchangeInventoryOnce = async (
  access: InventoryAccess,
  sessionDeviceId: string,
  accessToken: string | null,
): Promise<InventoryState> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* makeSyncSocketSession({
          open: openMobileSyncSocket({
            baseUrl: apiOrigin,
            organizationId: access.organizationId,
            deviceId: sessionDeviceId,
            accessToken,
          }),
          exchangeTimeoutMillis: REQUEST_TIMEOUT_MS,
        });
        yield* connectSyncSocketSession(session, { connectTimeoutMillis: REQUEST_TIMEOUT_MS });
        return yield* Effect.tryPromise({
          try: () => drainInventory(access, sessionDeviceId, session.exchange),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
      }),
    ),
  );

const exchangeInventory = async (access: InventoryAccess): Promise<InventoryState> => {
  const stableDeviceId = await persistentDeviceId();
  const accessToken = await getAccessToken();
  const initial = await access.withLock(() => loadInventoryState(access.organizationId));
  const sessionDeviceId =
    (initial.mutationState?.pendingOperations.length ?? 0) > 0
      ? (initial.mutationState?.deviceId ?? stableDeviceId)
      : stableDeviceId;

  try {
    return await exchangeInventoryOnce(access, sessionDeviceId, accessToken);
  } catch (cause) {
    if (!(cause instanceof SyncTransportError) || cause.code !== "CLIENT_SEQUENCE_REUSED")
      throw cause;
    // Durable device id survived a wiped sequence counter. Rebind pending work
    // onto a fresh device identity once, then retry the exchange.
    const rotatedDeviceId = await rotateDeviceAfterSequenceReuse(access);
    return exchangeInventoryOnce(access, rotatedDeviceId, accessToken);
  }
};

const drainInventory = async (
  access: InventoryAccess,
  sessionDeviceId: string,
  exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>,
): Promise<InventoryState> => {
  let hasMore = true;
  let pageCount = 0;
  let conflictMessage: string | null = null;
  const { organizationId, userId, withLock } = access;

  while (hasMore) {
    if (pageCount >= MAX_SYNC_PAGES) throw new Error("Inventory sync returned too many pages.");
    const prepared = await withLock(async () => {
      const state = await loadInventoryState(organizationId);
      if (state.mutationState) {
        const migrated = await reattributePendingOperations(
          state.mutationState.pendingOperations,
          userId,
          payloadHash,
        );
        if (migrated.changed) {
          state.mutationState.pendingOperations = migrated.operations;
          await persistMutationState(state.mutationState);
        }
      }
      const outgoing = selectPendingOperations(state.mutationState?.pendingOperations ?? []);
      return { cursor: state.cursor, outgoing };
    });
    const { cursor, outgoing } = prepared;
    let page: SyncResponse;
    try {
      page = await Effect.runPromise(
        requestPage(exchange, organizationId, sessionDeviceId, cursor, outgoing),
      );
    } catch (cause) {
      const conflictedOperation = outgoing[0];
      if (
        cause instanceof SyncTransportError &&
        cause.code === "ENTITY_CONFLICT" &&
        conflictedOperation &&
        isStockAdjustment(conflictedOperation)
      ) {
        await withLock(async () => {
          const state = await loadInventoryState(organizationId);
          if (!state.mutationState) return;
          state.mutationState.pendingOperations = state.mutationState.pendingOperations.filter(
            (operation) => operation.operationId !== conflictedOperation.operationId,
          );
          await persistMutationState(state.mutationState);
        });
        conflictMessage = "Stock changed on another device. Review the count and update it again.";
        pageCount += 1;
        hasMore = true;
        continue;
      }
      throw cause;
    }
    assertSyncProgress(cursor, page.nextCursor, page.hasMore);

    const acknowledged = new Set(page.acknowledgements.map((entry) => entry.operationId));
    if (outgoing.some((operation) => !acknowledged.has(operation.operationId)))
      throw new Error("The inventory server did not acknowledge a submitted change.");

    hasMore = await withLock(async () => {
      const state = await loadInventoryState(organizationId);
      if (state.mutationState && acknowledged.size > 0) {
        state.mutationState.pendingOperations = state.mutationState.pendingOperations.filter(
          (operation) => !acknowledged.has(operation.operationId),
        );
        await persistMutationState(state.mutationState);
      }
      applyProductSyncChanges(state.maps, page.changes);
      state.cursor = Math.max(state.cursor, page.nextCursor);
      for (const operation of state.mutationState?.pendingOperations ?? [])
        applyLocalChanges(state, operation.changes, operation.occurredAt);
      await persistInventoryCache(state);
      return page.hasMore || (state.mutationState?.pendingOperations.length ?? 0) > 0;
    });
    pageCount += 1;
  }

  const state = await withLock(() => loadInventoryState(organizationId));
  if (conflictMessage) throw new Error(conflictMessage);
  return state;
};

const persistInventoryCache = (state: InventoryState) =>
  Storage.setItem(
    state.cacheKey,
    serializeProductSyncState(state.organizationId, state.cursor, state.maps),
  );

const applyLocalChanges = (
  state: InventoryState,
  changes: ReadonlyArray<SyncEntityChange>,
  occurredAt: number,
) => {
  for (const change of changes) {
    if (change.entity === "stockMovement") continue;
    const current =
      change.entity === "category"
        ? state.maps.categories.get(change.entityId)
        : change.entity === "product"
          ? state.maps.products.get(change.entityId)
          : state.maps.batches.get(change.entityId);
    applyProductSyncChanges(state.maps, [
      {
        cursor: state.cursor,
        change: {
          ...change,
          row: {
            ...change.row,
            rowVersion: change.rowVersion,
            createdAt: current?.createdAt ?? occurredAt,
            updatedAt: occurredAt,
          },
        },
      },
    ]);
  }
};

const enqueueOperation = async (
  state: InventoryState,
  actorUserId: string,
  changes: ReadonlyArray<SyncEntityChange>,
) => {
  if (changes.length === 0) return null;
  const stableDeviceId = await persistentDeviceId();
  const existingMutationState = state.mutationState;
  const mutationState =
    !existingMutationState ||
    (existingMutationState.pendingOperations.length === 0 &&
      existingMutationState.deviceId !== stableDeviceId)
      ? ({
          version: 1,
          organizationId: state.organizationId,
          deviceId: stableDeviceId,
          nextClientSequence: 1,
          pendingOperations: [],
        } satisfies StoredMutationState)
      : existingMutationState;
  const migrated = await reattributePendingOperations(
    mutationState.pendingOperations,
    actorUserId,
    payloadHash,
  );
  mutationState.pendingOperations = migrated.operations;

  const unhashed = {
    operationId: Crypto.randomUUID(),
    organizationId: state.organizationId,
    deviceId: mutationState.deviceId,
    actorUserId,
    clientSequence: mutationState.nextClientSequence,
    occurredAt: Date.now(),
    changes,
  } satisfies Omit<SyncOperation, "payloadHash">;
  const operation: SyncOperation = { ...unhashed, payloadHash: await payloadHash(unhashed) };
  mutationState.nextClientSequence += 1;
  mutationState.pendingOperations.push(operation);
  state.mutationState = mutationState;
  await persistMutationState(mutationState);
  return operation;
};

export const commitLocalOperation = async (
  state: InventoryState,
  actorUserId: string,
  changes: ReadonlyArray<SyncEntityChange>,
) => {
  const operation = await enqueueOperation(state, actorUserId, changes);
  if (!operation) return;
  applyLocalChanges(state, changes, operation.occurredAt);
  await persistInventoryCache(state);
};

export const loadWorkspaceInventoryState = async (
  access: InventoryAccess,
): Promise<InventoryState> => loadInventoryState(access.organizationId);

/** Local maps only — never exchanges. */
export const readLocalInventorySnapshot = (access: InventoryAccess): Promise<InventorySnapshot> =>
  access.withLock(async () => {
    const state = await loadInventoryState(access.organizationId);
    return snapshotFromMaps(state.maps);
  });

/** Exchange if remote user; local-only users skip network. */
export const synchronizeInventory = async (access: InventoryAccess): Promise<InventorySnapshot> => {
  if (isLocalUserId(access.userId)) {
    const state = await loadInventoryState(access.organizationId);
    return snapshotFromMaps(state.maps);
  }
  const state = await access.withSyncLock(() => exchangeInventory(access));
  return snapshotFromMaps(state.maps);
};
