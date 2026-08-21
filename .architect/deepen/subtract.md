# Subtract-before-you-add — recent architecture

Scope: uncommitted + recent work around auth wall / HostAccess, mobile inventory split, session HTTP, sync-client `openSyncSocket`, auth service split, scan phase.

Deletion test: if removing the module/export does not force callers to invent the same logic elsewhere, delete it.

---

## Implemented this pass

| Path | What | Risk | Why safer after |
| --- | --- | --- | --- |
| `apps/mobile/src/lib/products.ts` | Deleted pass-through barrel; callers import `inventory-{types,session,snapshot,sync,mutations}` directly | Low | One less hop; fails deletion test as a pure re-export façade |
| `apps/mobile/src/features/products/use-batch-writes.ts` | Removed dead `export { batchMutationTarget }` re-export | None | Nothing imported it from here; tests already use `batch-mutation-target` |
| `apps/mobile/src/lib/inventory-sync.ts` | Deleted unused `loadProducts`; un-exported `loadInventoryState` | None | Zero external callers; thinner public surface |
| `apps/mobile/src/lib/inventory-snapshot.ts` | Un-exported `mobileBatch` | None | Module-private mapper only used inside `snapshotFromMaps` |
| `apps/web/src/lib/auth.tsx` | Removed unused `export type { WorkspaceSnapshot }` re-export | None | Callers already take the type from `@store/contracts` |

**Already gone (confirmed):** `apps/mobile/src/features/product-scanner/scan-api.ts` — was a one-line re-export of `inferProductFromImage`; deleted earlier; no remaining imports.

---

## Ranked proposals (do not implement yet)

### 1. High ROI / medium risk

| Path | What to delete/collapse | Risk | Why safer after |
| --- | --- | --- | --- |
| `apps/web/src/components/app/sync-status.tsx` + `dashboard/home-page.tsx` | Remove `offline-store:sync` window Event bus | Medium | `store.onSyncStatusChange` already exists; Event is a second, global sync channel. Home can subscribe to the store; SyncStatusIndicator need not `dispatchEvent` after `store.sync()`. Deletes a hidden cross-component seam. |
| `apps/web/src/lib/auth.tsx` dual bridge | Collapse `sessionBridge ?? window.auth` to one resolution | Medium | Today web calls `setAuthSessionBridge`; Electron relies on `window.auth`. Have `start-electron` also `setAuthSessionBridge(window.auth)` (or a thin adapter), then read only `sessionBridge` / only `authSession()`. Removes dual-path bugs and the soft-fail vs throw split in `useEffect` vs `authSession()`. |

### 2. Medium ROI / higher risk

| Path | What to delete/collapse | Risk | Why safer after |
| --- | --- | --- | --- |
| `HostAccessPolicy` surface (`admit` + `chrome` + `signIn.allowContinueOffline` + `allowLockedStore`) | Deepen into one admission decision (see design-host-access) | High | Four flags/methods invite sprawl; Candidate B’s `guestMode` was rejected for shallowness, but the current policy is still multi-knob. Collapse only after a chosen deepen design. |
| Mobile inventory stack vs `@store/persistence` OfflineStore | Collapse second brain (design-mobile-inventory) | High | `inventory-*` is a full sync engine beside desktop OfflineStore. Deleting modules without a shared OfflineStore adapter reintroduces the god module. |
| `apps/auth/src/service.ts` | Keep as Effect wiring only; do not re-grow a façade | Low–med | Already thin after split into `session-ops` / `login` / `organization-ops` / `google-identity`. Subtract is “do not add back”; further deletion of the service tag would break Layer composition. |
| Platform sync wrappers (`openBrowserSyncSocket` / `openMobileSyncSocket` / `openDesktopSyncSocket`) | Keep; they are real adapters over `openSyncSocket` | — | Pass `connect` + headers; fail the deletion test (platform construction must live somewhere). |

### 3. Low ROI / leave alone

| Item | Finding |
| --- | --- |
| `guestMode` leftovers | **None in runtime code.** Only `.architect/auth-wall/candidate-b.md` + synthesis wording. Do not delete architect design records. |
| Magic notes / protocol leftovers | No `MAGIC` / `FIXME` / protocol note-gate comments in the touched app/lib surfaces grepped this pass. |
| Speculative `fixedHostAccess` | Mentioned in Candidate A draft only; **not shipped** — good. |
| `inventory-types` import cycles | **No cycle.** Graph is acyclic: `types` ← session/snapshot/sync/mutations; sync → session + snapshot; mutations → session + snapshot + sync. Types depend on `mobile-sync-queue` / `product-sync-state` (types only); those do not import inventory-*. |
| Persistence `browser.ts` / `core.ts` re-exports of sync-client | Package entry points, not dead pass-throughs — keep. |

---

## Checklist for future subtract passes

1. Prefer deleting barrels after a split lands (this pass did `products.ts`).
2. Un-export anything that only has same-file callers before extracting further helpers.
3. Replace CustomEvent / global buses when a typed subscription already exists on the store.
4. Unify host bridge registration at bootstrap instead of dual fallback resolution in React effects.
