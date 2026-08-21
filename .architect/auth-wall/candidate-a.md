# Candidate A: Bootstrap-injected host access policy

**Arena:** auth-wall the web app but NOT the desktop Electron app  
**Status:** design sketch only — no production implementation  
**Synthesis decision:** pending

---

## Verified constraints (from codebase)

- Shared renderer: `apps/web` boots via `start-web.tsx` (browser) and
  `start-electron.tsx` (Electron). Both call `mountApp`.
- `getRouter` + generated `routeTree` are shared. `RouterContext` today is
  `{ store, initialAuth }` (`routes/__root.tsx`).
- Desktop product rule (also in `packages/auth/ARCHITECTURE.md`): a signed-out
  desktop opens the local / locked store; auth is optional. Web must not offer
  that path as the happy path into app routes.
- Today there is **no** route-level session wall. `__root` only skips the app
  chrome on `/sign-in`. Sign-in shows “Continue offline” unconditionally
  (`components/auth/page.tsx`). `VITE_ELECTRON` appears in branding / Vite
  define, not as an access policy.
- Naive alternative to reject: `if (!import.meta.env.VITE_ELECTRON) …` inside
  every route `beforeLoad`.

---

## 1. Usage first (call sites)

### `start-web.tsx`

```ts
import { browserHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startWeb = async () => {
  // ... existing workspace bootstrap unchanged ...
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: browserHostAccess(),
  });
};
```

### `start-electron.tsx`

```ts
import { desktopHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  const store = electronStore();
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    access: desktopHostAccess(),
  });
  // ... existing OAuth callback wiring unchanged ...
};
```

### `mount-app.tsx` → `router.tsx`

```ts
export const mountApp = (input: {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
}) => {
  const router = getRouter({
    history: input.history,
    store: input.store,
    initialAuth: input.initialAuth,
    access: input.access,
  });
  // ... render RouterProvider as today ...
};

export const getRouter = (input: {
  readonly history: RouterHistory;
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly access: HostAccessPolicy;
}) =>
  createRouter({
    routeTree,
    context: {
      store: input.store,
      initialAuth: input.initialAuth,
      access: input.access,
    },
    history: input.history,
    // ... existing defaults ...
  });
```

### Single router seam — `routes/__root.tsx`

Leaf routes stay host-blind. Only the root admits navigation and chooses chrome.

```ts
export interface RouterContext {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly access: HostAccessPolicy;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const snapshot =
      context.initialAuth._tag === "Session" ? context.initialAuth.snapshot : null;
    // Live session: prefer AuthProvider updates once wired into context
    // (see Open questions). admit() itself does not care about the source.
    const verdict = context.access.admit({
      location: { pathname: location.pathname },
      snapshot,
    });
    if (verdict._tag === "Redirect") {
      throw redirect({ to: verdict.to, replace: verdict.replace });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

function AppShell() {
  const { access } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const chrome = access.chrome({ pathname });

  if (chrome._tag === "Bare") return <Outlet />;
  return (
    <TooltipProvider>
      {/* existing sidebar shell */}
      <Outlet />
    </TooltipProvider>
  );
}
```

### Sign-in affordances — `components/auth/page.tsx`

```ts
function IdentifyStep(/* ... */) {
  const { access } = Route.useRouteContext({ from: "__root__" });
  // ...
  {access.signIn.allowContinueOffline ? (
    <p>
      Your local inventory works without an account.{" "}
      <Link to="/">Continue offline</Link>
    </p>
  ) : null}
}
```

No `VITE_ELECTRON` at these call sites. Host choice is a constructor at the two
start entrypoints only.

---

## 2. Type sketch + signatures (not implemented)

```ts
// apps/web/src/host-access.ts
import { redirect } from "@tanstack/react-router";
import type { WorkspaceSnapshot } from "@store/contracts";

/** Where the user is trying to go, stripped to what access needs. */
export interface AccessLocation {
  readonly pathname: string;
}

/**
 * Outcome of one admit() call. Completes the host decision in one step —
 * callers do not classify routes, then check auth, then pick a URL.
 */
export type AccessVerdict =
  | { readonly _tag: "Allow" }
  | {
      readonly _tag: "Redirect";
      readonly to: "/sign-in" | "/";
      readonly replace: true;
    };

export type AppChrome =
  | { readonly _tag: "Bare" } // sign-in (and future public pages)
  | { readonly _tag: "Shell" }; // normal app chrome

/**
 * Host access policy.
 *
 * Interface facts callers must know:
 * - Inject exactly one adapter at bootstrap (`browserHostAccess` or
 *   `desktopHostAccess`). Do not construct ad-hoc policies in routes.
 * - `admit` is the only guard entry. It is pure w.r.t. inputs: same location +
 *   snapshot ⇒ same verdict. Side effect (throw redirect) stays in the route.
 * - Does not expose host kind, Electron flags, or “is public path?” helpers.
 * - Sign-in UI reads `signIn` only; it must not re-derive offline rules.
 */
export interface HostAccessPolicy {
  readonly admit: (input: {
    readonly location: AccessLocation;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => AccessVerdict;

  readonly chrome: (input: AccessLocation) => AppChrome;

  readonly signIn: {
    /** Desktop: link home without an account. Browser: omit. */
    readonly allowContinueOffline: boolean;
  };
}

const hasAuthenticatedWorkspace = (
  snapshot: WorkspaceSnapshot | null,
): boolean =>
  snapshot?.status === "authenticated" && snapshot.activeOrganization != null;

// --- adapters ---------------------------------------------------------------

/** Browser: app routes require an authenticated workspace. */
export const browserHostAccess = (): HostAccessPolicy => {
  // TODO: implement public-path set (at least "/sign-in") behind this closure.
  // TODO: unauthenticated app entry → Redirect /sign-in.
  // TODO: authenticated /sign-in → Redirect /.
  // TODO: chrome Bare only on public paths; Shell elsewhere.
  // TODO: signIn.allowContinueOffline = false.
  throw new Error("not implemented");
};

/** Desktop: anonymous / locked local store remains a first-class entry. */
export const desktopHostAccess = (): HostAccessPolicy => {
  // TODO: allow all pathnames regardless of snapshot status.
  // TODO: optional: authenticated /sign-in still redirects home (UX only).
  // TODO: chrome Bare on /sign-in; Shell elsewhere (same visual split as today).
  // TODO: signIn.allowContinueOffline = true.
  throw new Error("not implemented");
};

// Optional test helper — not a third product host.
export const fixedHostAccess = (_policy: HostAccessPolicy): HostAccessPolicy => {
  // TODO: identity / wrap for unit tests of root beforeLoad without Vite env.
  throw new Error("not implemented");
};

// Intentionally NOT exported (information leakage screen):
// - isElectron / hostKind / requiresAuth boolean
// - isPublicPath(pathname) as a public method
// - separate classify() + enforce() stages on the interface
```

Router context extension (sketch):

```ts
// routes/__root.tsx — additive field only
export interface RouterContext {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly access: HostAccessPolicy;
}
```

Reactive session note (sketch, not a second public API):

Live snapshot updates may refresh router context or re-invoke `admit` from the
root layout. Exact wiring is an open question; `HostAccessPolicy.admit` stays
unchanged either way.

---

## 3. Module map

```
apps/web/src/
  host-access.ts              NEW — HostAccessPolicy + browser/desktop adapters
  start-web.tsx               inject browserHostAccess() into mountApp
  start-electron.tsx          inject desktopHostAccess() into mountApp
  mount-app.tsx               thread `access` into getRouter
  router.tsx                  put `access` on router context
  routes/__root.tsx           sole admit() + chrome() call sites for navigation/shell
  routes/sign-in.tsx          unchanged aside from shared context; no host branch
  routes/**                   remain host-blind (no beforeLoad auth walls)
  components/auth/page.tsx    read access.signIn.allowContinueOffline only
  lib/auth.tsx                unchanged session bridge; may later publish live
                              snapshot into router context (implementation detail)

Does NOT belong in the module:
  packages/auth               identity / tokens — different seam
  apps/desktop main/preload   already host-specific; no renderer policy leak back
  per-route VITE_ELECTRON     rejected
```

**Seam placement:** between host entrypoints (`start-*`) and the shared router
tree. The policy adapter is chosen once; the route tree depends only on
`HostAccessPolicy`.

**Depth claim:** callers learn three facts (`admit`, `chrome`, `signIn`
affordance). Behind that: which paths are public, how “authenticated workspace”
is detected, browser vs desktop rules, and redirect targets. Deleting the module
re-scatters those rules across `__root`, sign-in, and every future gated route.

---

## 4. Rationale (architect template)

### Problem

One React tree serves browser and Electron. The browser must refuse app routes
without an authenticated workspace; the desktop must keep signed-out / offline /
locked local use. Without a host seam, the temptation is to sprinkle
`VITE_ELECTRON` (or equivalent) through `beforeLoad` hooks and the sign-in
screen — shallow, leaky, and easy to get wrong on the next route.

### Usage

Start scripts pick an adapter. `mountApp` / `getRouter` carry it on context.
The root route calls `admit` once per navigation and `chrome` for shell vs bare
layout. Sign-in reads one boolean affordance. Leaf routes never mention host or
auth walls.

### Shape

One deep module, `HostAccessPolicy`, with two product adapters and an optional
test fixed adapter. Public surface is decision-shaped (`AccessVerdict`,
`AppChrome`), not flag-shaped. Route classification and host rules stay inside
the adapters. The route layer throws TanStack `redirect` from a verdict; it does
not re-implement policy.

Screened:

| Red flag | How this candidate avoids it |
| --- | --- |
| Shallow module | Not a thin `isElectron()` wrapper; adapters own path sets + verdicts |
| Information leakage | No `hostKind` / `requiresAuth` export; UI gets affordances, not host identity |
| Temporal decomposition | No public `classify` then `enforce`; `admit` is one transition |
| Pass-through methods | No getters that return constructor inputs unchanged |

### Tradeoffs

- **Accepted:** root `beforeLoad` must receive a current snapshot (bootstrap
  and/or live). Wiring live auth into router context is extra work; the policy
  interface stays stable.
- **Accepted:** public-path knowledge lives in both adapters (or a shared private
  helper). Duplication of a tiny path set is cheaper than exporting
  `isPublicPath` and inviting host checks elsewhere.
- **Accepted:** leaf routes cannot opt into custom auth rules without expanding
  the policy module. That concentration is intentional.
- **Cost:** `RouterContext` grows by one field; tests that build routers must
  pass an access adapter (use `desktopHostAccess` or `fixedHostAccess`).

### Alternatives considered

1. **Per-route `VITE_ELECTRON` guards** — maximal leakage; fails the brief.
2. **Boolean `requireAuth` on mountApp** — smaller interface, but callers and
   root still invent redirect URLs, public paths, and sign-in copy branches;
   policy knowledge leaks back into the route layer (shallow + temporal split).
3. **Separate route trees / `routeTree.web` vs `routeTree.desktop`** — strong
   isolation, high churn on every screen; duplicates the shared product UI.
4. **React-only wall in `AuthenticatedLayout`** — easy to flash protected UI
   before redirect; harder to block deep links consistently; still needs a host
   branch somewhere unless injected like this policy.

### Open questions

- Should live `WorkspaceSnapshot` updates re-run `admit` via router context
  mutation, a root-level effect, or TanStack auth integration patterns already
  used elsewhere?
- Is `/sign-in` the only public path, or do OAuth return URLs / error pages need
  Bare chrome too?
- On desktop, should visiting `/sign-in` while already authenticated redirect
  home (symmetric UX) or stay put?
- Does browser need a hard block (no offline inventory at all) or only a
  navigation wall (local DB may still exist under the hood via `host.ts` Locked
  target)? Product intent: wall navigation; confirm Locked store behavior on
  web remains acceptable behind the wall.

### Next step

Implement `host-access.ts` adapters + thread `access` through `mountApp` /
`getRouter` / `__root` / sign-in affordance. Add unit tests that assert verdict
tables for browser vs desktop without mounting Electron. Do not add
`VITE_ELECTRON` to routes.

### Synthesis decision

pending
