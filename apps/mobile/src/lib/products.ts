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

import { apiOrigin, fetchWorkspaceSession, getAccessToken } from "@/lib/auth-client";
import { isLocalUserId } from "@/lib/local-session";
import { type MobileSyncOperation, reattributePendingOperations } from "@/lib/mobile-sync-queue";
import {
  applyProductSyncChanges,
  assertSyncProgress,
  type BatchRow,
  type CategoryRow,
  type ProductRow,
  type ProductSyncMaps,
  restoreProductSyncState,
  serializeProductSyncState,
} from "@/lib/product-sync-state";
import { openMobileSyncSocket } from "@/lib/sync-socket";

type SyncEntity = "category" | "product" | "batch" | "stockMovement";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

type SyncEntityChange = {
  entity: SyncEntity;
  action: "upsert";
  entityId: string;
  rowVersion: number;
  row: object;
};

type SyncOperation = MobileSyncOperation<SyncEntityChange>;

type StoredMutationState = {
  version: 1;
  organizationId: string;
  deviceId: string;
  nextClientSequence: number;
  pendingOperations: Array<SyncOperation>;
};

type InventoryState = {
  organizationId: string;
  cacheKey: string;
  cursor: number;
  maps: ProductSyncMaps;
  mutationState: StoredMutationState | null;
};

type StoredInventoryContext = {
  version: 1;
  userId: string;
  organizationId: string;
};

export type MobileCategory = {
  id: string;
  name: string;
  tracksPacks: boolean;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type MobileBatch = {
  id: string;
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
  packQuantity: number;
  unitQuantity: number;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type MobileProduct = {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  tracksPacks: boolean;
  composition: string | null;
  strength: string | null;
  details: string;
  aisle: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitPrice: number | null;
  visible: boolean;
  stock: number;
  stockLabel: string;
  batches: ReadonlyArray<MobileBatch>;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type InventorySnapshot = {
  products: ReadonlyArray<MobileProduct>;
  categories: ReadonlyArray<MobileCategory>;
};

type ProductMutationTarget =
  | { productId: string; newProductId?: never }
  | { productId?: null; newProductId: string };

type BatchMutationTarget =
  | { batchId: string; newBatchId?: never }
  | { batchId?: null; newBatchId: string };

export type SaveScannedProductInput = ProductMutationTarget & {
  name: string;
  categoryId?: string;
  aisle?: string | null;
  composition?: string | null;
  strength?: string | null;
  unitsPerPack?: number;
  packPrice?: number | null;
  unitPrice?: number | null;
  visible?: boolean;
};

export type SaveBatchDetailsInput = BatchMutationTarget & {
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
};

export type UpdateBatchQuantityInput = BatchMutationTarget & {
  productId: string;
  packQuantity: number;
  unitQuantity: number;
  batchNumber?: string | null;
  expiresAt?: number | null;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SYNC_PAGES = 1_000;
const MAX_CHANGES_PER_REQUEST = 1_000;
const CACHE_KEY_PREFIX = "tabaaq-product-sync-v1";
const MUTATION_KEY_PREFIX = "tabaaq-product-mutations-v1";
const INVENTORY_CONTEXT_KEY = "tabaaq-product-context-v1";

export const createInventoryEntityId = () => Crypto.randomUUID();

let organizationIdPromise: Promise<string | null> | null = null;
let activeUserId: string | null = null;
let inventoryQueue: Promise<void> = Promise.resolve();
let inventorySyncQueue: Promise<void> = Promise.resolve();

const withInventoryLock = <T>(work: () => Promise<T>): Promise<T> => {
  const result = inventoryQueue.then(work, work);
  inventoryQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const withInventorySyncLock = <T>(work: () => Promise<T>): Promise<T> => {
  const result = inventorySyncQueue.then(work, work);
  inventorySyncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const persistentDeviceId = async () => {
  const key = "tabaaq-device-id";
  const stored = await SecureStore.getItemAsync(key);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(key, created);
  return created;
};

const readInventoryContext = async (userId: string): Promise<StoredInventoryContext | null> => {
  const serialized = await Storage.getItem(INVENTORY_CONTEXT_KEY);
  if (!serialized) return null;
  try {
    // SAFETY: Every required field is checked before this value is returned.
    const value = JSON.parse(serialized) as Partial<StoredInventoryContext>;
    if (
      value.version !== 1 ||
      value.userId !== userId ||
      !Schema.is(Schema.String)(value.organizationId) ||
      !value.organizationId
    ) {
      return null;
    }
    // SAFETY: Version, user, and non-empty organization fields were validated above.
    return value as StoredInventoryContext;
  } catch {
    return null;
  }
};

const persistInventoryContext = (userId: string, organizationId: string) =>
  Storage.setItem(
    INVENTORY_CONTEXT_KEY,
    JSON.stringify({ version: 1, userId, organizationId } satisfies StoredInventoryContext),
  );

const organizationIdFromLocalContext = async (userId: string) => {
  const localContext = await readInventoryContext(userId);
  return localContext?.organizationId ?? null;
};

const ensureLocalOrganizationId = async (userId: string) => {
  const existing = await organizationIdFromLocalContext(userId);
  if (existing) return existing;
  const organizationId = `local-org:${Crypto.randomUUID()}`;
  await persistInventoryContext(userId, organizationId);
  return organizationId;
};

const activeOrganizationId = async () => {
  organizationIdPromise ??= (async () => {
    if (activeUserId) {
      const localOrganizationId = await organizationIdFromLocalContext(activeUserId);
      if (localOrganizationId) return localOrganizationId;
      if (isLocalUserId(activeUserId)) return ensureLocalOrganizationId(activeUserId);
    }

    try {
      const session = await fetchWorkspaceSession();
      const userId = session.user?.id;
      if (!userId) return null;
      activeUserId = userId;

      const localOrganizationId = await organizationIdFromLocalContext(userId);
      if (localOrganizationId) return localOrganizationId;

      const organization = session.activeOrganization ?? session.organizations[0];
      if (!organization) return null;
      await persistInventoryContext(userId, organization.id);
      return organization.id;
    } catch (cause) {
      if (activeUserId) {
        const localOrganizationId = await organizationIdFromLocalContext(activeUserId);
        if (localOrganizationId) return localOrganizationId;
      }
      throw cause;
    }
  })().catch((cause) => {
    organizationIdPromise = null;
    throw cause;
  });
  return organizationIdPromise;
};

const authenticatedUserId = async () => {
  if (activeUserId) return activeUserId;
  try {
    const session = await fetchWorkspaceSession();
    const id = session.user?.id;
    if (!id) throw new Error("Sign in before changing inventory.");
    activeUserId = id;
    return id;
  } catch (cause) {
    if (activeUserId) return activeUserId;
    throw cause;
  }
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

const isMobileStockCorrection = (operation: SyncOperation) =>
  operation.changes.some(
    (change) =>
      change.entity === "stockMovement" &&
      "note" in change.row &&
      change.row.note === "Stock corrected from mobile scanner",
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

const rotateDeviceAfterSequenceReuse = async (organizationId: string) => {
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync("tabaaq-device-id", created);
  await withInventoryLock(async () => {
    const state = await loadInventoryState(organizationId);
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
      organizationId,
      deviceId: created,
      nextClientSequence: nextSequence,
      pendingOperations,
    };
    await persistMutationState(state.mutationState);
  });
  return created;
};

const exchangeInventoryOnce = async (
  organizationId: string,
  sessionDeviceId: string,
  userId: string,
  accessToken: string | null,
): Promise<InventoryState> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* makeSyncSocketSession({
          open: openMobileSyncSocket({
            baseUrl: apiOrigin,
            organizationId,
            deviceId: sessionDeviceId,
            accessToken,
          }),
          exchangeTimeoutMillis: REQUEST_TIMEOUT_MS,
        });
        yield* connectSyncSocketSession(session, { connectTimeoutMillis: REQUEST_TIMEOUT_MS });
        return yield* Effect.tryPromise({
          try: () => drainInventory(organizationId, userId, sessionDeviceId, session.exchange),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
      }),
    ),
  );

const exchangeInventory = async (organizationId: string): Promise<InventoryState> => {
  const stableDeviceId = await persistentDeviceId();
  const userId = await authenticatedUserId();
  const accessToken = await getAccessToken();
  const initial = await withInventoryLock(() => loadInventoryState(organizationId));
  const sessionDeviceId =
    (initial.mutationState?.pendingOperations.length ?? 0) > 0
      ? (initial.mutationState?.deviceId ?? stableDeviceId)
      : stableDeviceId;

  try {
    return await exchangeInventoryOnce(organizationId, sessionDeviceId, userId, accessToken);
  } catch (cause) {
    if (!(cause instanceof SyncTransportError) || cause.code !== "CLIENT_SEQUENCE_REUSED")
      throw cause;
    // Durable device id survived a wiped sequence counter. Rebind pending work
    // onto a fresh device identity once, then retry the exchange.
    const rotatedDeviceId = await rotateDeviceAfterSequenceReuse(organizationId);
    return exchangeInventoryOnce(organizationId, rotatedDeviceId, userId, accessToken);
  }
};

const drainInventory = async (
  organizationId: string,
  userId: string,
  sessionDeviceId: string,
  exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>,
): Promise<InventoryState> => {
  let hasMore = true;
  let pageCount = 0;
  let conflictMessage: string | null = null;

  while (hasMore) {
    if (pageCount >= MAX_SYNC_PAGES) throw new Error("Inventory sync returned too many pages.");
    const prepared = await withInventoryLock(async () => {
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
        isMobileStockCorrection(conflictedOperation)
      ) {
        await withInventoryLock(async () => {
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

    hasMore = await withInventoryLock(async () => {
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

  const state = await withInventoryLock(() => loadInventoryState(organizationId));
  if (conflictMessage) throw new Error(conflictMessage);
  return state;
};

const loadActiveInventoryState = async (): Promise<InventoryState | null> => {
  const organizationId = await activeOrganizationId();
  if (!organizationId) return null;
  return loadInventoryState(organizationId);
};

const loadSynchronizedState = async (): Promise<InventoryState | null> => {
  const organizationId = await activeOrganizationId();
  if (!organizationId) return null;
  if (activeUserId && isLocalUserId(activeUserId)) return loadInventoryState(organizationId);
  return withInventorySyncLock(() => exchangeInventory(organizationId));
};

const mobileBatch = (batch: BatchRow): MobileBatch => ({
  id: batch.id,
  productId: batch.productId,
  batchNumber: batch.batchNumber,
  expiresAt: batch.expiresAt,
  packQuantity: batch.packQuantity,
  unitQuantity: batch.unitQuantity,
  rowVersion: batch.rowVersion,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

const snapshotFromMaps = (maps: ProductSyncMaps): InventorySnapshot => {
  const categories = [...maps.categories.values()]
    .map((category): MobileCategory => ({
      id: category.id,
      name: category.name,
      tracksPacks: category.tracksPacks,
      rowVersion: category.rowVersion,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const batchesByProduct = new Map<string, Array<MobileBatch>>();
  for (const batch of maps.batches.values()) {
    const rows = batchesByProduct.get(batch.productId) ?? [];
    rows.push(mobileBatch(batch));
    batchesByProduct.set(batch.productId, rows);
  }
  for (const batches of batchesByProduct.values())
    batches.sort(
      (left, right) =>
        (left.expiresAt ?? Number.POSITIVE_INFINITY) -
          (right.expiresAt ?? Number.POSITIVE_INFINITY) || left.createdAt - right.createdAt,
    );

  const products = [...maps.products.values()]
    .map((product): MobileProduct => {
      const category = maps.categories.get(product.categoryId);
      const batches = batchesByProduct.get(product.id) ?? [];
      const stock = batches.reduce(
        (total, batch) => total + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
        0,
      );
      return {
        id: product.id,
        name: product.name,
        categoryId: product.categoryId,
        category: category?.name ?? "Uncategorized",
        tracksPacks: category?.tracksPacks ?? true,
        composition: product.composition,
        strength: product.strength,
        details: [product.composition, product.strength].filter(Boolean).join(" · "),
        aisle: product.aisle,
        unitsPerPack: product.unitsPerPack,
        packPrice: product.packPrice,
        unitPrice: product.unitPrice,
        visible: product.visible,
        stock,
        stockLabel: `${stock} ${stock === 1 ? "unit" : "units"}`,
        batches,
        rowVersion: product.rowVersion,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { products, categories };
};

const emptySnapshot = (): InventorySnapshot => ({ products: [], categories: [] });

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

const commitLocalOperation = async (
  state: InventoryState,
  actorUserId: string,
  changes: ReadonlyArray<SyncEntityChange>,
) => {
  const operation = await enqueueOperation(state, actorUserId, changes);
  if (!operation) return;
  applyLocalChanges(state, changes, operation.occurredAt);
  await persistInventoryCache(state);
};

const requireProduct = (maps: ProductSyncMaps, productId: string) => {
  const product = maps.products.get(productId);
  if (!product) throw new Error("The product no longer exists. Refresh and try again.");
  return product;
};

const requireBatch = (maps: ProductSyncMaps, productId: string, batchId: string) => {
  const batch = maps.batches.get(batchId);
  if (!batch || batch.productId !== productId)
    throw new Error("The batch no longer exists for this product. Refresh and try again.");
  return batch;
};

const requiredEntityId = (value: string | undefined, label: string) => {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200) throw new Error(`${label} is invalid.`);
  return normalized;
};

type ProductMutationResolution = { id: string; current: ProductRow | null };
type BatchMutationResolution = { id: string; current: BatchRow | null };

const resolveProductMutationTarget = (
  maps: ProductSyncMaps,
  input: ProductMutationTarget,
): ProductMutationResolution => {
  if (input.productId) {
    if (input.newProductId) throw new Error("Choose either an existing or a new product.");
    return { id: input.productId, current: requireProduct(maps, input.productId) };
  }

  const id = requiredEntityId(input.newProductId, "New product id");
  return { id, current: maps.products.get(id) ?? null };
};

const resolveBatchMutationTarget = (
  maps: ProductSyncMaps,
  productId: string,
  input: BatchMutationTarget,
): BatchMutationResolution => {
  if (input.batchId) {
    if (input.newBatchId) throw new Error("Choose either an existing or a new batch.");
    return { id: input.batchId, current: requireBatch(maps, productId, input.batchId) };
  }

  const id = requiredEntityId(input.newBatchId, "New batch id");
  const current = maps.batches.get(id) ?? null;
  if (current && current.productId !== productId)
    throw new Error("The saved batch belongs to a different product.");
  return { id, current };
};

const requiredName = (value: string) => {
  const normalized = value.trim();
  if (!normalized) throw new Error("Product name is required.");
  if (normalized.length > 120) throw new Error("Product name must be 120 characters or fewer.");
  return normalized;
};

const optionalText = (value: string | null, maximum: number, label: string) => {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maximum)
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return normalized;
};

const nonNegativeInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative whole number.`);
  return value;
};

const nullablePrice = (value: number | null, label: string) =>
  value === null ? null : nonNegativeInteger(value, label);

const expiryTimestamp = (value: number | null) => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new Error("Expiry date must be a valid timestamp.");
  return value;
};

const productChange = (
  id: string,
  rowVersion: number,
  row: Omit<ProductRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "product", action: "upsert", entityId: id, rowVersion, row });

const categoryChange = (
  id: string,
  row: Omit<CategoryRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "category", action: "upsert", entityId: id, rowVersion: 1, row });

const batchChange = (
  id: string,
  rowVersion: number,
  row: Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">,
): SyncEntityChange => ({ entity: "batch", action: "upsert", entityId: id, rowVersion, row });

const movementChange = (input: {
  productId: string;
  batchId: string;
  type: "stock_in" | "adjustment";
  packDelta: number;
  unitDelta: number;
  note: string;
}): SyncEntityChange => {
  const id = Crypto.randomUUID();
  return {
    entity: "stockMovement",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: {
      id,
      productId: input.productId,
      batchId: input.batchId,
      invoiceId: null,
      type: input.type,
      packDelta: input.packDelta,
      unitDelta: input.unitDelta,
      note: input.note,
    },
  };
};

const mobileProductById = (snapshot: InventorySnapshot, productId: string) => {
  const product = snapshot.products.find((candidate) => candidate.id === productId);
  if (!product) throw new Error("The saved product could not be loaded.");
  return product;
};

const mobileBatchById = (snapshot: InventorySnapshot, productId: string, batchId: string) => {
  const batch = mobileProductById(snapshot, productId).batches.find(
    (candidate) => candidate.id === batchId,
  );
  if (!batch) throw new Error("The saved batch could not be loaded.");
  return batch;
};

export const inventorySnapshot = async (): Promise<InventorySnapshot> => {
  const state = await loadSynchronizedState();
  return state ? snapshotFromMaps(state.maps) : emptySnapshot();
};

export const readCachedInventorySnapshot = (userId: string): Promise<InventorySnapshot> =>
  withInventoryLock(async () => {
    activeUserId = userId;
    const context =
      (await readInventoryContext(userId)) ??
      (isLocalUserId(userId)
        ? {
            version: 1 as const,
            userId,
            organizationId: await ensureLocalOrganizationId(userId),
          }
        : null);
    if (!context) return emptySnapshot();
    organizationIdPromise = Promise.resolve(context.organizationId);
    const state = await loadInventoryState(context.organizationId);
    return snapshotFromMaps(state.maps);
  });

export const loadProducts = async (): Promise<ReadonlyArray<MobileProduct>> =>
  (await inventorySnapshot()).products;

export const saveScannedProduct = (input: SaveScannedProductInput): Promise<MobileProduct> =>
  withInventoryLock(async () => {
    const state = await loadActiveInventoryState();
    if (!state) throw new Error("Create or join a store before adding products.");
    const { id, current } = resolveProductMutationTarget(state.maps, input);
    const inputCategoryId = input.categoryId?.trim() || undefined;
    const requestedCategoryId =
      inputCategoryId ?? current?.categoryId ?? state.maps.categories.keys().next().value;
    const createsGeneralCategory = !requestedCategoryId && state.maps.categories.size === 0;
    const categoryId = createsGeneralCategory ? "general" : requestedCategoryId;
    if (!categoryId || (!createsGeneralCategory && !state.maps.categories.has(categoryId)))
      throw new Error("Choose a category for this product.");
    const category = state.maps.categories.get(categoryId);
    const unitsPerPack =
      (category?.tracksPacks ?? true)
        ? nonNegativeInteger(input.unitsPerPack ?? current?.unitsPerPack ?? 1, "Units per pack")
        : 1;
    if (unitsPerPack < 1) throw new Error("Units per pack must be at least 1.");
    const row = {
      id,
      name: requiredName(input.name),
      categoryId,
      aisle: optionalText(
        input.aisle === undefined ? (current?.aisle ?? null) : input.aisle,
        64,
        "Aisle",
      ),
      composition: optionalText(
        input.composition === undefined ? (current?.composition ?? null) : input.composition,
        160,
        "Composition",
      ),
      strength: optionalText(
        input.strength === undefined ? (current?.strength ?? null) : input.strength,
        20,
        "Strength",
      ),
      unitsPerPack,
      packPrice:
        (category?.tracksPacks ?? true)
          ? nullablePrice(
              input.packPrice === undefined ? (current?.packPrice ?? null) : input.packPrice,
              "Pack price",
            )
          : null,
      unitPrice: nullablePrice(
        input.unitPrice === undefined ? (current?.unitPrice ?? null) : input.unitPrice,
        "Unit price",
      ),
      visible: input.visible ?? current?.visible ?? true,
    } satisfies Omit<ProductRow, "rowVersion" | "createdAt" | "updatedAt">;
    const actorUserId = await authenticatedUserId();
    const changes = createsGeneralCategory
      ? [
          categoryChange("general", { id: "general", name: "General", tracksPacks: true }),
          productChange(id, (current?.rowVersion ?? 0) + 1, row),
        ]
      : [productChange(id, (current?.rowVersion ?? 0) + 1, row)];
    await commitLocalOperation(state, actorUserId, changes);
    return mobileProductById(snapshotFromMaps(state.maps), id);
  });

export const saveBatchDetails = (input: SaveBatchDetailsInput): Promise<MobileBatch> =>
  withInventoryLock(async () => {
    const state = await loadActiveInventoryState();
    if (!state) throw new Error("Create or join a store before changing inventory.");
    requireProduct(state.maps, input.productId);
    const { id, current } = resolveBatchMutationTarget(state.maps, input.productId, input);
    const row = {
      id,
      productId: input.productId,
      batchNumber: optionalText(input.batchNumber, 64, "Batch number"),
      expiresAt: expiryTimestamp(input.expiresAt),
      packQuantity: current?.packQuantity ?? 0,
      unitQuantity: current?.unitQuantity ?? 0,
    } satisfies Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">;
    const actorUserId = await authenticatedUserId();
    await commitLocalOperation(state, actorUserId, [
      batchChange(id, (current?.rowVersion ?? 0) + 1, row),
    ]);
    return mobileBatchById(snapshotFromMaps(state.maps), input.productId, id);
  });

export const updateBatchQuantity = (input: UpdateBatchQuantityInput): Promise<MobileBatch> =>
  withInventoryLock(async () => {
    const state = await loadActiveInventoryState();
    if (!state) throw new Error("Create or join a store before changing inventory.");
    const product = requireProduct(state.maps, input.productId);
    const category = state.maps.categories.get(product.categoryId);
    const { id, current } = resolveBatchMutationTarget(state.maps, input.productId, input);
    const requestedPackQuantity = nonNegativeInteger(input.packQuantity, "Pack quantity");
    const unitQuantity = nonNegativeInteger(input.unitQuantity, "Unit quantity");
    if (category?.tracksPacks === false && !current && requestedPackQuantity !== 0)
      throw new Error("This category tracks individual units, not packs.");
    const packQuantity =
      category?.tracksPacks === false ? (current?.packQuantity ?? 0) : requestedPackQuantity;

    if (!current && packQuantity + unitQuantity < 1)
      throw new Error("Add at least one pack or unit when creating stock.");
    const packDelta = packQuantity - (current?.packQuantity ?? 0);
    const unitDelta = unitQuantity - (current?.unitQuantity ?? 0);
    const row = {
      id,
      productId: input.productId,
      batchNumber: optionalText(
        input.batchNumber === undefined ? (current?.batchNumber ?? null) : input.batchNumber,
        64,
        "Batch number",
      ),
      expiresAt: expiryTimestamp(
        input.expiresAt === undefined ? (current?.expiresAt ?? null) : input.expiresAt,
      ),
      packQuantity,
      unitQuantity,
    } satisfies Omit<BatchRow, "rowVersion" | "createdAt" | "updatedAt">;
    const changes: SyncEntityChange[] = [batchChange(id, (current?.rowVersion ?? 0) + 1, row)];
    if (packDelta !== 0 || unitDelta !== 0)
      changes.push(
        movementChange({
          productId: input.productId,
          batchId: id,
          type: current ? "adjustment" : "stock_in",
          packDelta,
          unitDelta,
          note: current ? "Stock corrected from mobile scanner" : "Initial scanner stock",
        }),
      );

    const actorUserId = await authenticatedUserId();
    await commitLocalOperation(state, actorUserId, changes);
    return mobileBatchById(snapshotFromMaps(state.maps), input.productId, id);
  });

export const resetProductsSession = () => {
  organizationIdPromise = null;
  activeUserId = null;
};

export const formatPrice = (paisa: number | null) => {
  if (paisa === null) return "—";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: paisa % 100 === 0 ? 0 : 2,
  }).format(paisa / 100);
};
