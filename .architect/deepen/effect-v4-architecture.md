# Effect v4 architecture deepenings

**Pin:** `effect` / `@effect/*` = **`4.0.0-rc.110`** (verified `node_modules/effect`).  
**Lens:** Impact × fit with Effect v4 tools (`Context.Service`, `Layer`, `Schema.TaggedError`, `Effect.fn`, `Semaphore`/`Deferred`, `SubscriptionRef`/`Stream`, `Schedule`, `Cache`, unstable `HttpClient`, `ManagedRuntime`).  
**Inputs:** `.agents/skills/effect` (+ SERVICES_LAYERS, SCHEMA, HTTP_CLIENTS, STREAMS, CACHING, CONFIG), deepen artifacts under `.architect/deepen/`, and live usage in auth / persistence / workspace / sync-client / hosts.

This pass is **opinionated about Effect shape**, not a re-hash of every deepen candidate. Non-Effect product work (scan-session UI, HostAccess chrome, OfflineStore RN client) is called out only where it intersects Effect runtime/error/stream boundaries.

---

## 1. Verdict — highest-conviction Effect deepenings

Ranked **impact × v4 fit**. Prefer subtractive rewrites that delete Promise islands and dual truth sources.

| # | Deepening | Why now | v4 tools |
| --- | --- | --- | --- |
| **1** | **Live workspace snapshot as one reactive source of truth** (kill frozen `initialAuth` + dual admit) | Auth wall is demo-correct on cold start and wrong after session transitions; `router.invalidate()` cannot refresh bootstrap context | `SubscriptionRef` (or host-owned mutable ref updated from the same publish path) + single `beforeLoad` admit; optional `Stream` of snapshots for UI |
| **2** | **Model Locked/guest refuse as typed idle, not `workspaceError`** | Unsigned web cold start publishes policy refusal as `workspaceError` → Auth boots `_tag: "Error"` | `Schema.TaggedError` / `Data.TaggedEnum` for activation outcomes; map guest-deny to clean unauthenticated **without** error payload |
| **3** | **Deepen `AuthenticatedWorkspace` activation onto Effect serialization** | `#serialize` Promise chain + plain `Error` throws fight the surrounding `ManagedRuntime` / `OfflineStore` Effect world | `Context.Service` (+ `make` / explicit layer) or keep class but drive transitions with `Semaphore.withPermit` / `Effect.fn`; typed activation errors |
| **4** | **`SessionHttpClient` → Effect boundary (refresh coalesce + typed errors)** | Shared HTTP is deep; still a Promise island with dishonest `refreshSession: null \| throw` across hosts | `Effect.fn`, `Deferred`/`Semaphore` for coalesce, `Schema.TaggedError` instead of `RequestError extends Error`; prefer unstable `HttpClient` when adapters allow |
| **5** | **Shared session broker as one Effect/plain deep module over host adapters** | Web/desktop brokers still duplicate adopt/renew/publish/offline mapping (candidates §4, how-critique) | One broker interface; hosts inject TokenStore + refresh policy only; org roster/organize Schema decode once |
| **6** | **Mobile `InventoryWorkspace` with Effect locks (Design 2), not OfflineStore yet** | Module Promise queues + exported globals are the anti-`Semaphore` of sync-client; Design 1 blocked on RN DB | `Context.Service` or factory-held instance; `Semaphore` replaces `withInventoryLock`; keep KV engine private; ports for storage/transport |
| **7** | **Rename persistence `AuthenticatedWorkspace` Context** | Same name as workspace activation class → wrong imports / wrong mental Layer | Mechanical rename to e.g. `WorkspaceScope` / `InventoryWorkspaceScope`; keep activation name for CONTEXT.md |
| **8** | **Keep auth ops private; thin `AuthService` stays the Layer surface** | Ops split is real; advertising ops as seams invites shallow tests past `AuthServiceApi` | Status quo wiring (`Layer.effect` + `AuthService.of`); do **not** grow façade logic; optional `Effect.fn` on façade methods for spans |
| **9** | **Collapse HostAccess guest knobs (product), wire store open via one capability bit** | Four-field policy + throw string in `host.ts` is shallow sprawl; not primarily an Effect problem but blocks clean typed activate | Design-host-access Design 1 (`decide` / `allowsGuestWorkspace`); feed into deepening #2 |

**Already deep enough (do not “Effect-ify” further):** `packages/sync-client` runtime (`Semaphore`, `Schedule`, `SubscriptionRef`, `Stream`, `Effect.fn`), `openSyncSocket` thin `Effect.try` helper, persistence `OfflineStore` / sync engine exchange path, auth `Schema.TaggedError` + `Context.Service` + ops `Effect.fn`.

---

## 2. Anti-patterns found

Concrete fights with Effect v4 discipline (citations are symbols / line ranges at time of writing).

### Promise islands beside Effect runtimes

| Location | Smell |
| --- | --- |
| `packages/workspace/src/workspace.ts` — `AuthenticatedWorkspace.#transition` / `#serialize` (~91, 233–239) | Hand-rolled Promise mutex. Sync-client already solved this with `Semaphore.make(1)` (`packages/sync-client/src/runtime.ts` ~29–42). |
| `packages/workspace/src/session-http.ts` — `SessionHttpClient` (~124–205), `#refreshInFlight` (~132, 156–163) | Promise coalesce + raw `fetch`. Errors are `RequestError extends Error` (~23–33), not `Schema.TaggedError`. |
| `packages/workspace/src/workspace.ts` — `WorkspaceAuthAdapter` / `WorkspaceStore` (~30–55) | Public surface is `Promise`-only; `runStore` is the only Effect seam, and it rejects with plain `Error` when store missing (~127–128). |
| `apps/mobile/src/lib/inventory-session.ts` — `withInventoryLock` / `withInventorySyncLock` (~24–42), exported `activeUserId` / `organizationIdPromise` (~14–22) | Process-global Promise queues + mutable session identity — dual of what Design 2 / Effect services forbid. |
| `apps/mobile/src/lib/inventory-sync.ts` — `Effect.tryPromise` (~248) | Isolated Effect call inside Promise inventory stack; no typed domain error channel for the cluster. |

### Frozen / dual truth (runtime + React, but Effect-shaped fix)

| Location | Smell |
| --- | --- |
| `apps/web/src/routes/__root.tsx` `beforeLoad` (~30–38) | Always admits from `context.initialAuth` — set once at mount (`mount-app.tsx` / `router.tsx`). |
| `apps/web/src/routes/__root.tsx` `AuthenticatedLayout` `useEffect` (~68–77) | Second admit from live `useAuth().snapshot` — race/flash/bounce after sign-in/out (interrogate-auth-wall BLOCKER/HIGH). |
| `apps/web/src/lib/auth.tsx` `apply` (~98–126) | `router.invalidate()` / `clearCache()` without rewriting router context session → beforeLoad stays frozen. |
| Dual bridge resolution `sessionBridge ?? window.auth` (`auth.tsx` ~47–50, 142) | Two resolution paths; subtract.md already flags collapse. |

### Error channel lies

| Location | Smell |
| --- | --- |
| `apps/web/src/host.ts` Locked refuse (~46–47) | `throw new Error("Sign in to open this workspace.")` — policy as stringly defect. |
| `packages/workspace/src/workspace.ts` `#activate` catch (~197–201) | Any open failure → `unauthenticated(..., message)` as **`workspaceError`**, then `WorkspaceActivationError`. Expected guest deny indistinguishable from real failure (interrogate BLOCKER #2). |
| `apps/web/src/lib/auth.tsx` `initialError` (~78–79) | Treats `snapshot.workspaceError` as boot `Error` state — unsigned web gets Error chrome. |
| `SessionHttpClientOptions.refreshSession` | Contract `Promise<TokenSet \| null>` but desktop throws / web returns null (how-critique §3) — cannot compose one Effect error model. |

### Naming / Layer confusion

| Location | Smell |
| --- | --- |
| `packages/persistence/src/config.ts` `AuthenticatedWorkspace` Context.Service (~22–34) | Same name as `packages/workspace/src/workspace.ts` class `AuthenticatedWorkspace` (~82). CONTEXT.md “authenticated workspace” maps to both. |
| `apps/auth/src/service.ts` façade (~92–106) | Correct thin Layer wiring, but methods are anonymous `(input) => handle(...)` — ops already use `Effect.fn("AuthService.*")`; façade adds a second wrap without its own `Effect.fn` / loses locality if someone tests ops directly. |

### What is *not* an anti-pattern here

- `Layer.mergeAll` in `apps/server/src/http/app.ts` / alchemy stacks — legitimate independent route/provider graphs, not “make it compile.”
- `Effect.try` in `openSyncSocket` — correct thin adapter boundary (HTTP_CLIENTS raw-fetch exception).
- `ManagedRuntime.make(browserLayer(...))` in `apps/web/src/host.ts` (~74) — correct host ↔ Effect bridge for OfflineStore.
- Auth/persistence `Schema.TaggedError` usage — already on the v4 path (no `TaggedErrorClass`, no `@effect/schema`).

---

## 3. Recommended designs

### 3.1 Live snapshot + single admit (Verdict #1)

**Current:** Bootstrap freezes `initialAuth` on router context; `beforeLoad` admits from it; React effect admits from live auth; invalidate does not refresh context.

**Target:**

1. Put **live** `WorkspaceSnapshot | null` on router context (rename away from `initialAuth` if needed).
2. On every workspace publish (`AuthenticatedWorkspace.#publish` / bridge `onSessionChange`), update that context field **before** invalidate.
3. `beforeLoad` admits **only** from that field; delete root + sign-in effect admits once green.
4. Optional Effect-native interior: host holds `SubscriptionRef<WorkspaceSnapshot>` (same pattern as `SyncClientRuntime` status); React subscribes via `SubscriptionRef.changes` → bridge, or keep a thin JS listener that is the **only** publisher into router context.

```ts
// Illustrative — router context update from the sole publish path
router.update({
  context: (prev) => ({ ...prev, session: { snapshot: next } }),
});
await router.invalidate();
```

**Subtract:** Dual admit effects, “invalidate keeps beforeLoad honest” comments that lie.

### 3.2 Typed activation outcomes (Verdict #2 + #9)

**Current:** Store open throws; activation maps all failures to `workspaceError`.

**Target:** Activation returns a tagged outcome, not “throw + side-publish”:

```ts
// Illustrative algebra (Data internally; Schema if it crosses IPC)
type ActivateResult =
  | { readonly _tag: "Ready"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Idle"; readonly snapshot: WorkspaceSnapshot } // guest deny / signed-out, workspaceError == null
  | { readonly _tag: "Failed"; readonly snapshot: WorkspaceSnapshot; readonly error: ActivationError };

class GuestWorkspaceRefused extends Schema.TaggedError<GuestWorkspaceRefused>()(
  "Workspace.GuestWorkspaceRefused",
  {},
) {}
```

`host.ts` / admission capability: refuse Locked by returning/failing **`GuestWorkspaceRefused`**, not `new Error("Sign in…")`. `#activate` maps that tag → Idle unauthenticated **without** `workspaceError`. Reserve `workspaceError` / `Failed` for unexpected persistence/sync open failures.

Align HostAccess Design 1: one `allowsGuestWorkspace` bit drives Locked open + continue-offline; stop exporting parallel booleans.

### 3.3 Effect-serialized workspace activation (Verdict #3)

**Current:** Class with Promise `#serialize`; store adapter returns Promise wrappers over `ManagedRuntime`.

**Target (prefer subtractive):** Keep the class as the host-facing orchestrator **or** promote to `Context.Service` only if a second runtime consumer appears. Minimum deepen:

```ts
// Inside layer / constructor acquisition
const lock = yield* Semaphore.make(1);
const execute = Effect.fn("AuthenticatedWorkspace.execute")(function* (command: WorkspaceCommand) {
  return yield* lock.withPermit(Effect.gen(function* () {
    const snapshot = yield* runCommand(command); // Effectful auth adapter
    return yield* activate(snapshot);
  }));
});
```

Host bridges keep `runPromise` at the UI/IPC edge (`ManagedRuntime` already does this for stores). Do **not** force React to yield Effect; force the **orchestrator** off Promise chains.

Longer term: `WorkspaceAuthAdapter` methods become `Effect` with `Schema.TaggedError`; `WorkspaceStoreAdapter.open` returns `Effect<WorkspaceStore, OpenError>` instead of throwing.

### 3.4 Session HTTP Effect boundary (Verdict #4)

**Current:** Class + Promise refresh coalesce + `RequestError` + host-dishonest null/throw.

**Target:**

1. Unify refresh contract: `Effect<TokenSet | null, RefreshError>` (or always fail typed — pick one; **forbid** null-vs-throw split).
2. Coalesce with `Deferred` or `Semaphore` + shared in-flight `Ref`, same as sync session exchange pending map.
3. Replace `RequestError` with `Schema.TaggedError` (`Workspace.RequestError` with status/code/message/cause).
4. Prefer `effect/unstable/http/HttpClient` + `HttpClientResponse.schemaBodyJson` when the host can provide an HttpClient layer; keep raw `fetch` only behind a named adapter (`SessionFetch`) as today if cookie/`net.fetch` constraints require it — still wrap in `Effect.fn("SessionHttp.request")`.

Do **not** thicken `openSyncSocket`; that helper is already the correct thin Effect edge.

### 3.5 Shared session broker (Verdict #5)

**Current:** `SessionHttpClient` deep; `WebAuthBroker` / desktop `AuthBroker` duplicate snapshot machine; org roster/organize Schema decode duplicated in `host.ts` / Electron IPC.

**Target:** One deep module (plain TS or `Context.Service`) owning:

`ensureFresh → GET session → map online/offline/error → publish`

Hosts supply only: `TokenStore`, `SessionFetch`, `needsRefresh` / `refreshSession` (honest Effect errors), optional persist. Fold org client decode next to broker (or small sibling), not in bridge glue.

Matches candidates §4 / how-critique — implement **after** #4’s refresh contract fix or the shared broker will paper over dishonest adapters.

### 3.6 Mobile InventoryWorkspace (Verdict #6)

**Current:** Split `inventory-*` + globals + Promise locks (Design-mobile-inventory Design 2 recommended).

**Target Effect shape for Design 2:**

```ts
export interface InventoryWorkspaceApi {
  readonly readSnapshot: Effect.Effect<InventorySnapshot, InventoryError>;
  readonly synchronize: Effect.Effect<InventorySnapshot, InventoryError>;
  readonly write: (command: InventoryCommand) => Effect.Effect<InventoryView, InventoryError>;
}

export class InventoryWorkspace extends Context.Service<
  InventoryWorkspace,
  InventoryWorkspaceApi
>()("@store/mobile/InventoryWorkspace") {}
```

- Acquire mutation + sync `Semaphore`s in `Layer.effect` / factory `open`.
- Inject storage + `openMobileSyncSocket` as adapters.
- UI continues `runPromise` at provider boundary (same as web OfflineStore).
- **Do not** port OfflineStore to Expo in this deepen (Design 1 blocked). Leave interface small so OfflineStore can become adapter B later.

### 3.7 Rename persistence scope tag (Verdict #7)

**Current:** `AuthenticatedWorkspace` Context in persistence vs class in workspace package.

**Target:** Rename Context to **`WorkspaceScope`** (or `InventoryWorkspaceScope`) with `WorkspaceScope.locked` + `WorkspaceScope.layer`. Keep `@store/workspace`’s activation name aligned with CONTEXT.md. Mechanical + docs; high navigability payoff for Layer wiring.

### 3.8 AuthService / ops (Verdict #8)

**Current:** Good v4 service (`Context.Service` + `Layer.effect` + `Schema.TaggedError`); ops factories only used by `service.ts`.

**Target:** Treat ops/crypto as **private implementation**. Tests and HTTP hit `AuthService` only. Optional: façade methods via `Effect.fn("AuthService.identify")` wrapping `handle(login.identify)` so spans stay on the public surface. Do **not** re-merge files for purity; do **not** export ops interfaces from package barrels.

Auth HTTP (`apps/auth/src/http.ts`) already Effect-gen — transport split (candidates §5) is optional cleanup, lower priority than workspace/session Effect islands.

---

## 4. Do not do

| Temptation | Why wrong here / for v4 |
| --- | --- |
| Rewrite React auth/router “in Effect” end-to-end | UI stays Promise/React; deepen the **orchestrator and error model**, publish into router context. |
| `Layer.mergeAll` / `provideMerge` every host concern into one AppLayer | Hosts need thin `ManagedRuntime` per store open; broad invisible layers hide authority (skill Do Nots). |
| Invent `Context.Tag` / `Effect.Service` / `Schema.TaggedErrorClass` / `@effect/schema` | Wrong for rc.110; codebase already uses `Context.Service` + `Schema.TaggedError`. |
| Deepen `openSyncSocket` into a “SyncOpenService” | Fails deletion test; hosts are real adapters (candidates §8, subtract.md). |
| Port mobile onto `OfflineStore` now “because Effect” | Blocked on RN DB client; creates fake seam (design-mobile-inventory). |
| Hand-roll Map/TTL refresh caches or sleep-loop sync | Sync-client already uses `Schedule` / `Semaphore` / `SubscriptionRef`; copy that, don’t invent v3 muscle memory. |
| `RequestResolver` batching for session/org HTTP | No batch endpoint; use `Effect.fn` + HttpClient + coalesce Deferred. |
| Grow `HostAccessPolicy` with more booleans / `requireAuth` | Design-host-access: collapse to one product axis; chrome is not a host port. |
| Advertise auth ops modules as public seams / ops-level test trees | AuthServiceApi is the interface; ops are file splits. |
| Fold BatchStore for “Effect purity” | Speculative (candidates §7); not an Effect runtime problem. |
| Replace sync-client Streams with callbacks “to simplify” | Runtime is the gold standard — extend its patterns outward. |
| Cache auth session snapshots in `effect/Cache` with long TTL | Session truth must be live; use `SubscriptionRef`, not TTL cache. |

---

## 5. Implementation order

Sequenced for the parent agent — each step should leave the tree greener and unlock the next.

1. **Live session on router context + single `beforeLoad` admit**  
   Delete dual effect admits. Add regression: unsigned → apply authenticated → invalidate → `/` Allows. *(Product correctness; unblocks honest Effect publish later.)*

2. **Guest Locked refuse → Idle without `workspaceError`**  
   Typed refuse in store open / activate; AuthProvider unsigned boot ≠ Error. Collapse HostAccess guest knobs to one bit while touching this path.

3. **Honest refresh + `Schema.TaggedError` on session HTTP**  
   Unify web/desktop refresh failure; replace `RequestError`; coalesce with Effect primitives (can still expose Promise API via `runPromise` at edges).

4. **Semaphore / `Effect.fn` inside `AuthenticatedWorkspace` transitions**  
   Replace `#serialize`; map open failures through tagged outcomes from step 2.

5. **Extract shared session broker** (adopt/renew/publish + org decode)  
   Thin host adapters only. Delete dead broker `onChange` if still unused.

6. **Rename persistence `AuthenticatedWorkspace` → `WorkspaceScope`**  
   Mechanical; do when touching persistence layers anyway.

7. **Mobile `InventoryWorkspace` factory** (Design 2)  
   Move locks/session inside; `Semaphore` or equivalent; provider consumes one interface. No OfflineStore port.

8. **Auth hygiene**  
   Keep ops private; optional façade `Effect.fn`; only then consider Auth HTTP transport split if cookie/origin churn hurts.

9. **Stop**  
   Do not schedule OfflineStore-on-Expo, openSyncSocket thickening, or BatchStore fold unless a second adapter appears.

---

## Reference map (gold vs debt)

| Area | Status |
| --- | --- |
| `packages/sync-client` runtime/session | **Gold** — copy patterns |
| `apps/auth` Service + TaggedError + ops `Effect.fn` | **Good** — keep private, don’t re-façade |
| `packages/persistence` OfflineStore / sync engine | **Good** — ManagedRuntime hosts OK |
| `packages/workspace` activation + session-http | **Debt** — Promise island + error lies |
| Web auth wall (`initialAuth`, dual admit, Locked error) | **Debt** — truth + admit |
| Mobile inventory cluster | **Debt** — globals + Promise locks; deepen per Design 2 |
| Dual `AuthenticatedWorkspace` name | **Debt** — rename persistence Context |

---

*Generated for Effect rc.110 deepen pass. Prefer deleting dual paths over adding Layers.*
