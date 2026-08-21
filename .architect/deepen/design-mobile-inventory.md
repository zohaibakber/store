# Design it twice: mobile inventory

**Candidate.** The mobile inventory cluster under `apps/mobile/src/lib/` — formerly `products.ts`, now split into `inventory-{types,session,snapshot,sync,mutations}` plus `product-sync-state`, `mobile-sync-queue`, and the `ProductsProvider` React façade.

**Goal.** Deepen the module: small interface, lots of behaviour, clean seam. Collapse or consciously contain the second inventory brain beside `@store/persistence` `OfflineStore` (desktop/web).

---

## Problem space

### What exists today

Mobile owns a **full offline inventory stack** that is not `OfflineStore`:

| Concern | Mobile | Desktop / web |
| --- | --- | --- |
| Local truth | `expo-sqlite/kv-store` JSON maps + mutation queue | libSQL + Drizzle via `OfflineStore` |
| Sync | Hand-rolled drain in `inventory-sync.ts` over `@store/sync-client` | `makeSyncEngine` inside persistence |
| Session / workspace | Module globals (`activeUserId`, `organizationIdPromise`, promise locks) | `AuthenticatedWorkspace` on the Effect runtime |
| Callers | `ProductsProvider` + a few direct imports (`createInventoryEntityId`, `formatPrice`, `resetProductsSession`) | `OfflineStoreApi` / workspace host |

The file split improved navigation; it did **not** deepen the interface. Callers still learn: session globals, cached vs live snapshot, lock ordering, mutation helpers, and React refresh orchestration. Tests and UI both reach past several shallow modules.

### Constraints any design must satisfy

1. **Authenticated workspace.** At most one active org + actor + device for inventory work (see `CONTEXT.md`). Mobile also supports a local-only user (`local-org:…`) that never exchanges.
2. **Offline-first.** Cached snapshot must paint before network; writes enqueue locally and sync later (or stay local forever).
3. **Scanner UX.** Create/update product, batch details, and quantity/adjustment with stock-movement side effects; stock-adjustment conflicts surface a human message and drop the conflicting op.
4. **Lifecycle.** Sign-out / user switch must clear session and stop attributing mutations to the wrong actor.
5. **Platform.** Expo RN today: SecureStore device id, KV cache keys, WebSocket via `openMobileSyncSocket`. No `@store/persistence` dependency yet; persistence’s DB clients are Node libSQL and browser OPFS libSQL — not RN.

### Dependencies (category)

| Dependency | Category | Notes |
| --- | --- | --- |
| Snapshot shaping, validation, entity ids | In-process | Deepenable freely |
| KV / SecureStore | Local-substitutable | Fake store in tests |
| `@store/sync-client` + API origin | Remote but owned | Port = sync transport; already injected in OfflineStore |
| `OfflineStore` / libSQL | Local-substitutable **if** a mobile DB client exists | Blocked today — no RN client layer |
| Auth session (`fetchWorkspaceSession`, tokens) | Remote but owned | Inject as workspace resolution, don’t bake into every mutation |

### Constraint sketch (not a proposal)

```ts
// Today’s accidental interface — what callers effectively must know
await readCachedInventorySnapshot(userId); // sets module globals as side effect
await inventorySnapshot();                 // may exchange; uses globals + sync lock
await saveScannedProduct(input);           // mutation lock + globals + enqueue
resetProductsSession();                    // auth tear-down
```

Any deepened design replaces that sprawl with one seam callers and tests share.

---

## Design 1 — Minimalist: thin adapter over shared `OfflineStore`

**Constraint.** Minimize the interface (1–3 entry points). Collapse the second brain: mobile stops owning sync maps / outbox / drain; it adapts `OfflineStore` (+ `@store/sync-client` transport) the way desktop/web already do.

### Interface

```ts
/** Mobile host owns lifetime of one OfflineStore runtime for the authenticated workspace. */
type MobileInventory = {
  /** Cold paint + background sync. Idempotent. */
  bootstrap(): Promise<InventoryView>;
  /** Domain writes used by scanner / product UI (maps to OfflineStore mutations). */
  write(command: InventoryCommand): Promise<InventoryView>;
  /** Tear down runtime; next bootstrap requires a fresh workspace. */
  dispose(): Promise<void>;
};

type InventoryCommand =
  | { _tag: "SaveProduct"; input: SaveScannedProductInput }
  | { _tag: "SaveBatchDetails"; input: SaveBatchDetailsInput }
  | { _tag: "UpdateBatchQuantity"; input: UpdateBatchQuantityInput };

type InventoryView = {
  products: ReadonlyArray<MobileProduct>; // view model, derived from Product/Batch
  categories: ReadonlyArray<MobileCategory>;
  sync: SyncStatus;
};
```

**Invariants.** One `MobileInventory` per signed-in workspace. `write` applies through `OfflineStore` then returns a fresh view (no separate “cache read” API). Sync is internal (`OfflineStore.sync` / status stream); callers may subscribe via `sync` on the view or a single `onSyncStatus` if needed later — not a second entry point unless proven.

**Errors.** Persistence / transport failures surface as thrown errors (or a Result type) from `bootstrap` / `write`. Stock conflicts become OfflineStore/sync-engine behaviour — mobile-specific “drop adjustment + message” must move into the shared engine or be dropped as a mobile-only quirk.

### Usage

```tsx
function ProductsProvider({ userId, children }) {
  const inventory = use(MobileInventoryContext); // created at auth boundary
  // bootstrap on mount / userId change; write from actions
}
```

`products.ts` and `inventory-*.ts` **delete** after the adapter + view mapper exist. Auth calls `dispose` instead of `resetProductsSession`.

### What the implementation hides

- libSQL open + migrations (new `mobileClientLayer` or equivalent)
- `AuthenticatedWorkspace` binding from mobile auth
- Sync socket open / exchange / outbox / quarantine (shared `makeSyncEngine`)
- Product/batch/movement mutation rules (shared `ProductStore` / `BatchStore`)
- Mapping `Product` → `MobileProduct` (stock labels, details string, etc.)

### Dependency strategy

- **Production adapter:** `OfflineStore` + mobile sync transport (`openMobileSyncSocket`).
- **Test adapter:** existing persistence test harness (`packages/persistence/test`) or in-memory layer — tests at `MobileInventory`, not KV maps.
- **Prerequisite seam:** a real RN database client for `@store/persistence` (category 2). Until that ships, Design 1 is blocked.

### Trade-offs

| | |
| --- | --- |
| **Depth** | Highest long-term: one brain, tiny mobile surface |
| **Locality** | Sync bugs / schema / conflict policy fixed once for all clients |
| **Seam** | Correct strategic seam (`OfflineStore`); mobile is a host adapter |
| **Cost** | Large: RN libSQL (or other) client, data migration from KV, reconcile mobile conflict UX with shared engine, Effect runtime wiring in Expo |
| **Thinness risk** | If `MobileInventory` only re-exports `OfflineStoreApi` method-for-method, the adapter is shallow — keep the command + view shape |

---

## Design 2 — Flexible: deepen behind `InventoryWorkspace`

**Constraint.** Maximise flexibility and extension while **keeping** the mobile sync engine. One deep module owns session, cache, sync, and mutations; React and scanner talk only to that interface.

### Interface

```ts
type InventoryWorkspace = {
  readonly userId: string;
  readonly organizationId: string;

  /** Local maps only — never exchanges. */
  readSnapshot(): Promise<InventorySnapshot>;
  /** Exchange if remote user; local-only users skip network. */
  synchronize(): Promise<InventorySnapshot>;

  saveScannedProduct(input: SaveScannedProductInput): Promise<MobileProduct>;
  saveBatchDetails(input: SaveBatchDetailsInput): Promise<MobileBatch>;
  updateBatchQuantity(input: UpdateBatchQuantityInput): Promise<MobileBatch>;

  /** Optional extension points without boolean soup */
  readonly syncStatus?: () => Promise<"idle" | "syncing" | "error">;
};

type InventoryWorkspaceFactory = {
  /** Resolve org (local or remote), bind device, return workspace. */
  open(userId: string): Promise<InventoryWorkspace>;
  /** Drop cached promises / locks for this process; does not wipe durable data. */
  close(): void;
};
```

**Invariants.** All reads/writes go through an opened workspace. No module-level `activeUserId` / `organizationIdPromise` — those live inside the workspace instance (or a process-level factory that holds the current instance). Locks are private implementation. `readSnapshot` must not mutate “active org” as a side effect of painting UI.

**Ordering.** `open` before any method. `close` on sign-out; subsequent calls throw. Mutations may call synchronize opportunistically internally, but callers that need “push now” use `synchronize` explicitly (ProductsProvider refresh).

**Errors.** Same user-facing strings as today where possible; damaged cache / queue remains hard errors.

### Usage

```ts
// auth boundary
const workspace = await inventoryFactory.open(userId);

// ProductsProvider
const snapshot = await workspace.readSnapshot();
await workspace.synchronize();
await workspace.saveScannedProduct(input);

// sign-out
inventoryFactory.close();
```

Internal files (`inventory-sync`, `inventory-mutations`, …) become **implementation** of one module; `products.ts` re-exports only the factory + types, or disappears in favour of `@/lib/inventory-workspace`.

### What the implementation hides

- Promise locks, device rotation on `CLIENT_SEQUENCE_REUSED`, pending op selection, conflict drop for stock adjustments
- Context persistence keys, local-org minting
- Map restore / apply / snapshot shaping
- Payload hashing and reattribution

### Dependency strategy

- **Injected ports (real seams):** sync transport (socket open), secure device id, KV storage, workspace session fetch — two adapters each (live + test).
- **Keep** mobile-specific sync/mutation code behind the workspace; do not expose `InventoryState` or maps.
- **Future:** a second adapter implementing `InventoryWorkspace` via `OfflineStore` (Design 1) without changing callers — only justified once the mobile DB client exists (**two adapters ⇒ real seam**).

### Trade-offs

| | |
| --- | --- |
| **Depth** | High for mobile: one object replaces five modules’ public surface |
| **Locality** | Mobile sync/mutation bugs stay in one place; still duplicated vs desktop until Design 1 |
| **Flexibility** | Easy to add invoice hooks, sync status, or import later as workspace methods |
| **Risk** | If the interface grows into a second `OfflineStoreApi`, depth erodes — stay command/query small |
| **Cost** | Moderate refactor; no RN database project |

---

## Design 3 — Caller-optimized: `ProductsProvider` owns session

**Constraint.** Optimise the default caller (`ProductsProvider`). Delete module globals; session and locks are constructed in the provider (or a hook it owns) and passed into pure-ish inventory functions.

### Interface

```ts
// No process globals. Explicit session bag.
type InventorySession = {
  userId: string;
  organizationId: string;
  deviceId: string;
  locks: InventoryLocks; // or create locks inside makeInventory(session)
};

type Inventory = {
  readCached(): Promise<InventorySnapshot>;
  synchronize(): Promise<InventorySnapshot>;
  saveScannedProduct(input: SaveScannedProductInput): Promise<MobileProduct>;
  saveBatchDetails(input: SaveBatchDetailsInput): Promise<MobileBatch>;
  updateBatchQuantity(input: UpdateBatchQuantityInput): Promise<MobileBatch>;
};

function makeInventory(session: InventorySession, deps: InventoryDeps): Inventory;

// ProductsProvider is the owner:
//   resolve session from auth → makeInventory → put Inventory on context
//   actions === inventory methods + React state refresh
// Auth no longer calls resetProductsSession(); unmounting provider drops the instance.
```

**Invariants.** `Inventory` is immutable binding to one session; user switch remounts provider / rebuilds `Inventory`. Module scope holds **zero** mutable session state.

**Caller default.** Screens only use `useProductData` / `useProductActions` — they never import `@/lib/inventory-*`. Direct imports of `createInventoryEntityId` / `formatPrice` stay as pure helpers (or move next to UI).

### What the implementation hides

Relative to today: mainly **where session lives**. Sync/mutation bodies can stay largely as-is but take `session` instead of reading globals. Less deepening of sync itself.

### Dependency strategy

- Session resolution stays near auth/React (category mix: remote session + local context).
- Inventory functions become testable with a fake `InventorySession` + fake KV (local-substitutable).
- Does **not** create a path to OfflineStore without another redesign — the second brain remains.

### Trade-offs

| | |
| --- | --- |
| **Depth** | Modest: removes globals, improves DI; sync engine still a wide implicit interface |
| **Locality** | Session bugs concentrate in provider; sync/mutation still split across files |
| **Caller fit** | Best match for current React tree; sign-out is structural (unmount) |
| **Risk** | Logic leaks into the provider (refresh orchestration + session + error policy); provider becomes a shallow god object |
| **Cost** | Smallest change set |

---

## Comparison

| | Depth | Locality | Seam placement | Feasibility now |
| --- | --- | --- | --- | --- |
| **1 Thin OfflineStore adapter** | Max (shared brain) | Max across clients | At `OfflineStore` (strategic) | Blocked on RN DB client + migration |
| **2 InventoryWorkspace** | High (mobile) | High within mobile; intentional dual brain until #1 | At workspace factory (tactical + future adapter slot) | Ready |
| **3 Provider-owned session** | Low–medium | Session only | At React context (wrong long-term home for sync) | Ready, smallest |

Design 1 and Design 2 are **radically different homes for the brain** (shared vs mobile-owned). Design 3 is **radically different ownership of session** without moving the brain. Combining 3’s “no globals” with 2’s workspace is natural: the factory/workspace instance *is* the session owner, and the provider only holds a reference.

---

## Recommendation

**Ship Design 2 (`InventoryWorkspace`), with Design 1 as the explicit future adapter.**

Why:

1. **Depth now.** One open/read/sync/write surface replaces the accidental interface of globals + split modules. Callers and tests share that seam.
2. **Honest about the platform.** Collapsing onto `OfflineStore` (Design 1) is the right end state for “one inventory brain,” but it is not a mobile-only deepen — it is a persistence platform feature (RN libSQL or equivalent). Pretending mobile can thin-adapt today creates a fake seam.
3. **Preserves a path to one brain.** `InventoryWorkspace` is the port; today’s KV sync engine is adapter A; later `OfflineStore` is adapter B. That satisfies “two adapters ⇒ real seam” without forcing the blocked migration first.
4. **Design 3 alone is insufficient.** Deleting globals is necessary hygiene and should be absorbed into Design 2’s workspace instance, but making `ProductsProvider` the inventory brain puts sync policy in the wrong layer and leaves the second brain intact.

### Suggested deepen sequence (design only — do not implement yet)

1. Introduce `InventoryWorkspace` + factory; move session/locks inside; stop exporting mutation/sync helpers from `products.ts` except through the workspace (or delete the barrel).
2. Point `ProductsProvider` at the workspace; remove `resetProductsSession` module globals (auth closes the factory).
3. Separately, spike RN persistence client; when green, implement OfflineStore-backed `InventoryWorkspace` and delete the KV sync engine.

### Out of scope / do not do in this deepen

- No drive-by OfflineStore port to Expo without a DB client plan.
- No expansion of the workspace into a full clone of `OfflineStoreApi` (invoices, analytics, import) until a real mobile caller needs them.
- No “tiny safe deletion” required for this design doc; the split files stay until the workspace absorbs them.

---

## Vocabulary check

| Term | Application here |
| --- | --- |
| **Module** | `InventoryWorkspace` (Design 2) or `MobileInventory` (Design 1) |
| **Interface** | Open/read/sync/write (+ dispose); invariants above, not merely TS types |
| **Seam** | Factory/`open` for mobile; eventually OfflineStore host boundary |
| **Adapter** | KV mobile engine today; OfflineStore later; test fakes for storage/transport |
| **Depth** | Leverage: scanner + products UI + tests exercise inventory without knowing queues, locks, or KV keys |
