# Auth wall — Candidate B

**Angle:** Host session capability (guest mode) decided at workspace bootstrap / mount; deep shell wraps `RouterProvider` on web only. Not per-route Electron checks. Not `HostAccessPolicy` in router context.

**Status:** Design only. Synthesis pending. No production implementation.

**Verified entry points (read):**

| File | Role today |
| --- | --- |
| `apps/web/src/main.tsx` → `start-web.tsx` | Browser: `startWebWorkspace` → `setAuthSessionBridge` → `completeGoogle` → `mountApp` + browser history |
| `apps/web/src/main.electron.tsx` → `start-electron.tsx` | Electron: `electronStore()` → `mountApp` + hash history; OAuth via `window.auth.onOAuthCallback` |
| `apps/web/src/mount-app.tsx` | Shared: `StoreProvider` → `RouterProvider` (no host split) |
| `apps/web/src/routes/__root.tsx` | `AuthProvider` inside root route; `AuthenticatedLayout` only waits on Loading; `AppShell` skips chrome on `/sign-in` only — **no signed-in requirement** |
| `apps/web/src/routes/sign-in.tsx` | Redirects away when `snapshot.status === "authenticated"` |
| `apps/web/src/lib/auth.tsx` | Bridge + `AuthProvider`; session from `sessionBridge` (web) or `window.auth` (Electron) |
| `apps/web/src/host.ts` | Web `AuthenticatedWorkspace`; opens **Locked** store when unauthenticated (`dataDir: tabaaq-locked`) |
| `packages/workspace/.../workspace.ts` | `WorkspaceTarget` = `Locked` \| `Authenticated`; both hosts activate Locked when unsigned |
| Mobile note | `apps/mobile/.../auth-provider.tsx`: “Mobile has no guest mode” — same product intent as web wall |

---

## 1. Usage first

Callers never ask the router whether the host is Electron. They declare **session capability once** at the host entry, then mount.

```ts
// apps/web/src/start-web.tsx — web: no guest / locked inventory
export const startWeb = async () => {
  const apiBaseUrl = resolveBrowserApiBaseUrl(/* ... */);
  const { bridge, store } = await startWebWorkspace(apiBaseUrl, authBaseUrl, {
    sessionAccess: { guestMode: false },
  });
  setAuthSessionBridge(bridge);
  await completeGoogle(globalThis.location.href).catch(() => false);
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    sessionAccess: { guestMode: false },
  });
};
```

```ts
// apps/web/src/start-electron.tsx — desktop: locked / guest inventory stays available
export const startElectron = async () => {
  const store = electronStore();
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    sessionAccess: { guestMode: true },
  });
  window.auth?.onOAuthCallback((url) => {
    void completeGoogle(url);
  });
};
```

```tsx
// apps/web/src/mount-app.tsx — shared mount; shell is the seam
export const mountApp = (input: {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly sessionAccess: SessionAccess;
}) => {
  const router = getRouter(input.history, input.store, input.initialAuth);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <StoreProvider store={input.store}>
          <AuthProvider initial={input.initialAuth}>
            <SessionAccessShell access={input.sessionAccess}>
              <RouterProvider router={router} />
            </SessionAccessShell>
          </AuthProvider>
        </StoreProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
};
```

```tsx
// SessionAccessShell — deep module: one prop, host-wide behaviour
function App() {
  // guestMode: true  → always render children (Electron today)
  // guestMode: false → Loading | AuthWall | children (web)
  return (
    <SessionAccessShell access={{ guestMode: false }}>
      <RouterProvider router={router} />
    </SessionAccessShell>
  );
}
```

Unsigned web user sees the auth wall **instead of** the router tree (no inventory chrome, no guest catalog). After `adoptSession` publishes authenticated snapshot, the same shell remounts `RouterProvider` children and the app proceeds. Electron never wraps with a denying shell — `guestMode: true` is a pass-through.

`__root.tsx` stops owning “am I allowed to browse?” It keeps chrome / `/sign-in` layout concerns only. Sign-in route remains useful for explicit navigation and post-auth redirect; the wall does not depend on `beforeLoad` or router context flags.

Workspace side (web bootstrap):

```ts
// When guestMode is false, unauthenticated activate must not open Locked
const workspace = new AuthenticatedWorkspace({
  auth,
  stores: makeWorkspaceStores(/* ... */),
  deviceId: loadDeviceId(),
  events: { /* ... */ },
  sessionAccess: { guestMode: false },
});
```

Web unsigned ⇒ no `tabaaq-locked` DB open; store adapter stays idle until `Authenticated`. Electron main (existing) keeps opening Locked — capability stays `guestMode: true` at that host.

---

## 2. Types / signatures (not implemented)

```ts
/**
 * Host-level session capability. Chosen at bootstrap / mount by the host
 * entry (start-web vs start-electron), not by route loaders.
 *
 * guestMode: true  — unsigned users may use a Locked workspace (desktop).
 * guestMode: false — unsigned users get no inventory surface (web ≈ mobile).
 */
export type SessionAccess = {
  readonly guestMode: boolean;
};

/**
 * Deep shell: either pass-through (guest allowed) or gate children on a
 * signed-in workspace snapshot. Lives outside RouterProvider.
 *
 * Invariants:
 * - Must sit under AuthProvider (reads useAuth).
 * - When guestMode is false and auth is Loading with no snapshot → AppLoading.
 * - When guestMode is false and snapshot is missing or status !== "authenticated"
 *   → render AuthWall; do not render children.
 * - When guestMode is false and snapshot.status === "authenticated" → children.
 * - When guestMode is true → always children (Electron).
 * - Does not write router context. Does not branch on import.meta / userAgent.
 *
 * Error modes: AuthProvider missing → throw (same as useAuth today).
 * Ordering: AuthProvider → SessionAccessShell → RouterProvider.
 */
export declare function SessionAccessShell(props: {
  readonly access: SessionAccess;
  readonly children: React.ReactNode;
}): React.ReactElement;

/**
 * Full-bleed signed-out UI for web (reuse AuthScreen / AuthForm).
 * Not a route; not registered in the route tree.
 */
export declare function AuthWall(): React.ReactElement;

/**
 * mountApp gains sessionAccess. Same Store + history + initialAuth as today.
 */
export declare function mountApp(input: {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly sessionAccess: SessionAccess;
}): void;

/**
 * Web workspace bootstrap carries the same capability so Locked is not opened
 * when guestMode is false.
 */
export declare function startWebWorkspace(
  baseUrl: string,
  authBaseUrl: string,
  options: { readonly sessionAccess: SessionAccess },
): Promise<WebWorkspace>;

/**
 * Optional deepening of AuthenticatedWorkspace (shared package).
 * If omitted, web host can refuse Locked open in makeWorkspaceStores instead.
 *
 * When guestMode is false and snapshot is unauthenticated:
 * - do not call stores.open({ _tag: "Locked" })
 * - keep runStore failing closed or no-op until Authenticated
 */
export declare type AuthenticatedWorkspaceOptions = {
  readonly auth: WorkspaceAuthAdapter;
  readonly stores: WorkspaceStoreAdapter;
  readonly events: WorkspaceEvents;
  readonly deviceId: string;
  readonly sessionAccess?: SessionAccess;
};

/** Lifted from __root: AuthProvider moves to mount so the shell can gate the router. */
// AuthProvider / bootstrapAuth / InitialAuth — existing; relocate call site only.
```

`RouterContext` stays `{ store, initialAuth }` — **no** `HostAccessPolicy`, **no** `sessionAccess` on the router. Route `beforeLoad` guards are out of scope for this candidate.

---

## 3. Module map

```
apps/web/src/main.tsx
  └─ start-web.tsx
       ├─ startWebWorkspace(..., { sessionAccess: { guestMode: false } })  [host.ts]
       │    └─ AuthenticatedWorkspace(+ sessionAccess)  [@store/workspace]
       │         └─ stores.open: Authenticated only when unsigned denied
       ├─ setAuthSessionBridge / bootstrapAuth
       └─ mountApp({ sessionAccess: { guestMode: false } })

apps/web/src/main.electron.tsx
  └─ start-electron.tsx
       └─ mountApp({ sessionAccess: { guestMode: true } })
            (Locked workspace remains Electron-main / AuthenticatedWorkspace default)

apps/web/src/mount-app.tsx          ← seam: host capability enters React tree
  ThemeProvider
    StoreProvider
      AuthProvider                  ← lifted from routes/__root.tsx
        SessionAccessShell          ← NEW deep module (apps/web/src/session-access-shell.tsx)
          AuthWall | children
            RouterProvider
              routes/__root.tsx     ← chrome + Outlet only; no host policy
                /sign-in, app routes, …

apps/web/src/components/auth/*      ← AuthWall reuses AuthScreen / AuthForm
apps/web/src/lib/auth.tsx           ← unchanged bridge semantics
```

**What moves:** `AuthProvider` from root route into `mountApp` (above the shell). Root layout keeps `ToastProvider` / shell chrome; it reads auth from the lifted provider (same context).

**What does not change:** Electron main process workspace, hash vs browser history, `getRouter` context shape, file route tree generation.

---

## 4. Rationale

### Problem

Web and Electron share one SPA mount and route tree. Unsigned **desktop** users are supposed to keep a **Locked** local inventory. Unsigned **browser** users should not browse that surface — they need an auth wall (aligned with mobile’s “no guest mode”). Today `__root` only special-cases `/sign-in` chrome; web still mounts the full app shell and opens `tabaaq-locked`. Putting `HostAccessPolicy` into router context would teach every loader/route about the host and couple navigation to platform policy.

### Usage

Host entries set one flag. `mountApp` always receives `sessionAccess`. Web sets `guestMode: false`; Electron sets `guestMode: true`. The shell and (optionally) workspace bootstrap consume that flag. Routes and components do not import Electron APIs or read a policy from router context.

### Shape

- **Seam:** `SessionAccess` at bootstrap + `SessionAccessShell` wrapping `RouterProvider`.
- **Deep module:** `SessionAccessShell` — small interface (`access` + `children`), hides loading / wall / pass-through.
- **Second locality:** refuse Locked open when `guestMode: false` so the wall is not only UI (store cannot silently serve guest data under an idle shell).
- **Adapters:** `start-web` / `start-electron` are the only callers that choose the capability; tests pass `{ guestMode: false|true }` into mount without a router.

### Tradeoffs

| Upside | Cost |
| --- | --- |
| Structurally opposite of router-context policy: wall is outside the router | Must lift `AuthProvider` above `RouterProvider` (root route loses ownership of provider placement) |
| Electron path stays a one-line pass-through | Unsigned web: router unmounted while wall shows — deep links into app routes only apply after sign-in (acceptable; OAuth completes before mount today) |
| Same capability can close Locked DB on web | Touching `AuthenticatedWorkspace` options is a shared-package change (or confine refuse-Locked to web `makeWorkspaceStores`) |
| Matches mobile product rule with an explicit host flag | `guestMode` must be passed consistently to workspace **and** mount (two call sites in `start-web`) — mitigate with a single `WebHostConfig` object later |

### Alternatives (rejected for this candidate)

1. **`HostAccessPolicy` on `RouterContext` + `beforeLoad`** — Candidate A shape; every route becomes host-aware; Electron checks leak into the tree. Explicitly not this doc.
2. **Split route trees / web-only `_authenticated` layout route** — Strong isolation, but duplicates or generates two trees and still mounts a router for unsigned users; heavier than a shell at the existing `start-*` split.
3. **`import.meta.env` / `window.electron` checks inside `__root`** — Shallow, scatters host knowledge, hard to test without faking globals.
4. **Server-only auth wall** — Does not stop local Locked SPA behaviour; Electron still needs guest.

### Open questions

1. While `guestMode: false` and unsigned, should `RouterProvider` stay mounted but hidden (preserve URL for post-login redirect) or unmount entirely (simpler; rely on default `/` after auth)?
2. Does `/sign-in` remain a real route for web, or does `AuthWall` fully replace it when the shell gates?
3. Prefer extending `AuthenticatedWorkspace` with `sessionAccess` vs refusing Locked only inside web `makeWorkspaceStores.open`?
4. Should Electron pass `guestMode: true` explicitly for clarity, or default `mountApp` to guest-allowed when omitted (desktop-safe default)?
5. After sign-out on web, shell returns to `AuthWall` — confirm product wants hard wall (no locked browse) vs soft redirect to `/sign-in` with empty shell.

### Next step

Spike lift of `AuthProvider` into `mount-app.tsx` with a pass-through `SessionAccessShell` (`guestMode: true` for both hosts), then flip web to `guestMode: false` and add `AuthWall`. Optionally gate Locked open in `startWebWorkspace` in the same spike. Compare against Candidate A in synthesis before implementing.

---

## Synthesis pending

Do not merge with other candidates here. Parent synthesis should compare depth, locality, and seam placement vs “inject HostAccessPolicy into router context” and any Candidate C (e.g. route-tree split).
