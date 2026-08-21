# Design it twice — deepen HostAccess

**Candidate:** `apps/web/src/host-access.ts` (`HostAccessPolicy` + `browserHostAccess` / `desktopHostAccess`)  
**Question:** Should this deepen into one decision module for **authenticated workspace admission**, using CONTEXT.md language?  
**Out of scope:** App code changes. This doc only explores interfaces.

Vocabulary (codebase-design): **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**.  
Vocabulary (CONTEXT.md): **authenticated workspace** — the signed-in user's selected organization plus its isolated local inventory and sync state; at most one active. Avoid "session" / "active organization" as the admission concept.

---

## Problem space

### What exists today

`HostAccessPolicy` is already a real seam with two product **adapters** (`browserHostAccess`, `desktopHostAccess`). Callers stay mostly host-blind. The **interface** currently exposes four facts:

| Fact | Role | Browser | Desktop |
| --- | --- | --- | --- |
| `admit(location, snapshot)` | Navigation wall | Unsigned → `/sign-in`; signed-in on public → `/` | Public bounce only if already authenticated |
| `chrome(location)` | Bare vs shell | Path-only (`/sign-in` → Bare) | **Same implementation** |
| `signIn.allowContinueOffline` | Sign-in UI | `false` | `true` |
| `allowLockedStore` | Workspace bootstrap / store open | `false` | `true` |

Call sites:

- `start-web.tsx` — builds access, **plucks** `allowLockedStore` into `startWebWorkspace`, passes access into `mountApp`
- `start-electron.tsx` — injects `desktopHostAccess()` into `mountApp` only (store lives in Electron main)
- `__root.tsx` — `beforeLoad` + live `useEffect` call `admit`; `AppShell` calls `chrome`
- `components/auth/page.tsx` — reads `signIn.allowContinueOffline`
- `host.ts` — refuses `WorkspaceTarget.Locked` when `allowLockedStore` is false

Tests hit the policy through `admit` + the two booleans (`apps/web/test/host-access.test.ts`).

### Constraints any deepened interface must satisfy

1. **Browser** must not browse inventory without an **authenticated workspace**, and must not open a Locked guest store (`tabaaq-locked`). Navigation wall alone is insufficient (auth-wall synthesis graft).
2. **Desktop** must treat absence of an authenticated workspace as a first-class entry (Locked local store + "continue offline" on sign-in).
3. Routes remain host-blind — no `VITE_ELECTRON`, no per-route platform checks, no split route trees.
4. Admission answers from **workspace snapshot + location**, not from a parallel "auth session" concept (CONTEXT.md).
5. Chrome for `/sign-in` stays Bare; app routes stay Shell — today this does **not** vary by host adapter.
6. Bootstrap and router must keep composing: history, store, initial auth, and whatever replaces `access`.

### Dependency category

**In-process.** Pure policy over pathname + `WorkspaceSnapshot | null`. No I/O. Deepenable by merging/reshaping the interface and testing through it directly (DEEPENING category 1). `host.ts` store open is a **consumer** of a capability bit, not a remote port.

### Illustrative constraint sketch (not a proposal)

```ts
// Today callers must know three shapes of the same product decision:
const access = browserHostAccess();
await startWebWorkspace(api, auth, { allowLockedStore: access.allowLockedStore });
mountApp({ ..., access });
// __root: access.admit(...) / access.chrome(...)
// sign-in: access.signIn.allowContinueOffline
```

The product rule is one sentence — *browser requires an authenticated workspace; desktop does not* — but the **interface** forces callers to reassemble that sentence from four fields and two call timings (bootstrap vs navigation).

### Interrogation: one module for "authenticated workspace admission"?

**Yes, as the conceptual center — with a caveat.**

What varies between adapters is whether the host may proceed **without** an authenticated workspace. That single product axis drives:

- navigation redirect to `/sign-in`
- whether Locked store open is allowed
- whether sign-in offers continue-offline

`chrome` is **not** on that axis today (identical adapters, path-only). Co-locating it on `HostAccessPolicy` is convenience, not host variance. A deepened **authenticated workspace admission** module should own the host-varying decision; chrome can ride along if that reduces caller knowledge, or stay a tiny path helper if we refuse to pretend it is host policy.

**Deletion test:** delete `host-access.ts` and the four-field policy reappears across `start-web`, `__root`, sign-in, and `host.ts` — so the cluster earns its keep. The deepening question is whether the **interface** can hide more of that reassembly (more depth / leverage) without inventing seams that only have one adapter.

---

## Design 1 — Minimalist (max leverage, 1–3 entry points)

### Interface sketch

One decision module. At most two entry points: runtime admission, and (optionally) a bootstrap projection so `start-web` does not invent a second API.

```ts
/** Product axis: may this host run without an authenticated workspace? */
export type HostProduct = "browser" | "desktop";

export type NavigationVerdict =
  | { readonly _tag: "Allow" }
  | { readonly _tag: "Redirect"; readonly to: "/sign-in" | "/"; readonly replace: true };

export type AppChrome = { readonly _tag: "Bare" } | { readonly _tag: "Shell" };

/**
 * Everything a caller needs after one admission decision.
 * Callers do not learn separate booleans or chrome rules.
 */
export type WorkspaceAdmission = {
  readonly navigation: NavigationVerdict;
  readonly chrome: AppChrome;
  /** True iff Locked / continue-offline is part of this host product. */
  readonly allowsGuestWorkspace: boolean;
};

export interface AuthenticatedWorkspaceAdmission {
  /**
   * Sole runtime entry point.
   * Invariant: `allowsGuestWorkspace` is stable for the adapter lifetime
   * (does not depend on location/snapshot); still returned so callers
   * never read a second field.
   */
  readonly decide: (input: {
    readonly location: { readonly pathname: string };
    readonly snapshot: WorkspaceSnapshot | null;
  }) => WorkspaceAdmission;
}

export const browserAdmission = (): AuthenticatedWorkspaceAdmission => { /* ... */ };
export const desktopAdmission = (): AuthenticatedWorkspaceAdmission => { /* ... */ };

/** Optional second entry: bootstrap-only projection (still ≤2 entry points). */
export const guestWorkspaceAllowed = (
  admission: AuthenticatedWorkspaceAdmission,
): boolean => admission.decide({ location: { pathname: "/" }, snapshot: null }).allowsGuestWorkspace;
```

Hard cap: **`decide` (+ optional pure helper)**. No `signIn` nest, no parallel `allowLockedStore` on the interface.

### Usage at call sites

```ts
// start-web.tsx
const admission = browserAdmission();
const { bridge, store } = await startWebWorkspace(apiBaseUrl, authBaseUrl, {
  allowLockedStore: guestWorkspaceAllowed(admission),
});
mountApp({ store, initialAuth, history, admission });

// start-electron.tsx
mountApp({ store, initialAuth, history, admission: desktopAdmission() });

// __root.tsx beforeLoad / effect
const { navigation } = context.admission.decide({ location, snapshot });
if (navigation._tag === "Redirect") throw redirect({ to: navigation.to, replace: true });

// AppShell
const { chrome } = admission.decide({ location: { pathname }, snapshot: auth.snapshot });

// sign-in
const { allowsGuestWorkspace } = admission.decide({ location: { pathname: "/sign-in" }, snapshot: null });
```

`host.ts` still takes `allowLockedStore: boolean` from bootstrap; that boolean is derived only via `guestWorkspaceAllowed` / `decide`, never as a first-class policy field.

### What the implementation hides

- Public path set and authenticated-workspace predicate (`status === "authenticated" && activeOrganization != null`)
- Browser vs desktop branching for redirects
- Correlation of Locked store + continue-offline into one `allowsGuestWorkspace`
- Path → chrome mapping

### Trade-offs

| Lens | Assessment |
| --- | --- |
| **Depth** | High. One verb (`decide`) returns the full surface. Learning cost is a single result type. |
| **Locality** | High for product rule changes. Weak locality for chrome-only tweaks (must touch admission result). |
| **Seam placement** | One external seam at bootstrap (`browserAdmission` / `desktopAdmission`). Correct: two real adapters on the product axis. |
| **Cost** | `__root` / sign-in may call `decide` where they only need a slice; `allowsGuestWorkspace` on every call is slightly awkward unless documented as stable. Optional helper avoids a third interface field but is a tiny second entry point. |

---

## Design 2 — Caller-optimized (trivial start-\* + `__root`)

### Interface sketch

Optimize for the **actual** callers (`start-web`, `start-electron`, `__root`, sign-in, `startWebWorkspace`), not for a neat policy object. The module presents **host-shaped facades** and **router hooks/helpers** so call sites stop assembling policy.

```ts
export type HostKind = "browser" | "desktop";

/** Injected once; routes never import adapters. */
export type AppHost = {
  readonly kind: HostKind;

  /** Web only: open workspace with Locked policy already applied. */
  readonly startWorkspace?: (input: {
    readonly apiBaseUrl: string;
    readonly authBaseUrl: string;
  }) => Promise<WebWorkspace>;

  /** Electron: store already exists; web: after startWorkspace. */
  readonly mount: (input: {
    readonly store: Store;
    readonly initialAuth: InitialAuth;
    readonly history: RouterHistory;
  }) => void;
};

export const createBrowserHost = (): AppHost => { /* wires admission + startWebWorkspace + mountApp */ };
export const createDesktopHost = (): AppHost => { /* wires admission + mountApp */ };

/** Router-facing seam — not the full HostAccessPolicy bag. */
export type AdmissionRouterApi = {
  /** beforeLoad: throw redirect or return. */
  readonly guard: (input: {
    readonly pathname: string;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => void;

  readonly chromeFor: (pathname: string) => AppChrome;
  readonly allowContinueOffline: boolean;
};

/** Placed on RouterContext instead of HostAccessPolicy. */
export const admissionFromContext = (host: AppHost): AdmissionRouterApi => { /* ... */ };
```

Ultra-caller version of `__root`:

```ts
// Inside AuthenticatedWorkspaceAdmission module (or host-access deepened file):
export const runAdmissionGuard = (
  api: AdmissionRouterApi,
  pathname: string,
  snapshot: WorkspaceSnapshot | null,
): void => {
  api.guard({ pathname, snapshot }); // implementation throws redirect via injected throwRedirect
};
```

Better: bake TanStack `redirect` into the guard so `__root` is three lines.

### Usage at call sites

```ts
// start-web.tsx — target shape
export const startWeb = async () => {
  const host = createBrowserHost();
  const apiBaseUrl = resolveBrowserApiBaseUrl({ ... });
  const { bridge, store } = await host.startWorkspace!({
    apiBaseUrl,
    authBaseUrl,
  });
  setAuthSessionBridge(bridge);
  await completeGoogle(globalThis.location.href).catch(() => false);
  host.mount({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
  });
};

// start-electron.tsx
export const startElectron = async () => {
  const host = createDesktopHost();
  host.mount({
    store: electronStore(),
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
  });
  window.auth?.onOAuthCallback((url) => { void completeGoogle(url); });
};

// __root.tsx
beforeLoad: ({ context, location }) => {
  const snapshot = context.initialAuth._tag === "Session" ? context.initialAuth.snapshot : null;
  context.admission.guard({ pathname: location.pathname, snapshot });
},
// AppShell
const chrome = admission.chromeFor(pathname);
// sign-in
admission.allowContinueOffline
```

`host.ts` is no longer told `allowLockedStore` by `start-web`; `createBrowserHost().startWorkspace` closes over refuse-Locked.

### What the implementation hides

- Entire `HostAccessPolicy` shape from bootstrap callers
- Correlation of guest workspace bits
- `mountApp` / `getRouter` threading of access
- Optionally: Effect/redirect throwing details inside `guard`
- Web-only workspace bootstrap options

### Trade-offs

| Lens | Assessment |
| --- | --- |
| **Depth** | Very high **for start-\*** (one host object). Medium for `__root` unless `guard` truly owns redirect. Risk: `AppHost` becomes a shallow façade over mount + workspace + admission (pass-through god object). |
| **Locality** | Bootstrap complexity concentrates in `createBrowserHost` / `createDesktopHost`. Admission rule changes still need a clear inner module or locality splits between "host factory" and "guard". |
| **Seam placement** | External seam moves **up** to "host runtime". That is a different seam than "admission policy". Dangerous if only one real variation is product policy — factories can hide a shallow mount wrapper. |
| **Cost** | Harder to unit-test admission without either extracting an inner pure module (Design 1) or testing through heavy host factories. Couples host-access deepening to `mountApp` / `startWebWorkspace` ownership. |

---

## Design 3 — Ports & adapters (navigation vs store capability)

### Do two real adapters exist?

**Yes, on two axes — but they are correlated today.**

| Port | Adapter A | Adapter B | Justified? |
| --- | --- | --- | --- |
| Navigation admission | Browser walls unsigned app routes | Desktop allows unsigned app routes | **Yes** — behavior differs |
| Store / guest capability | Refuse Locked + no continue-offline | Allow Locked + continue-offline | **Yes** — behavior differs; consumed by `host.ts` and sign-in |
| Chrome | Shared path rule | — | **No** — one adapter; do not promote to a port |

DEEPENING rule: *one adapter = hypothetical seam; two = real.* Splitting navigation vs store is legitimate **if** we expect independent evolution (e.g. browser PWA with Locked, or desktop that walls some routes). If they will always move in lockstep, two ports are ceremony and invite inconsistent composition (`desktopNavigation` + `refuseLockedStore`).

Sign-in continue-offline is the same product bit as Locked allow — fold into the store/guest port, not a third port.

### Interface sketch

```ts
/** Port A — where may the user go given workspace snapshot? */
export interface NavigationAdmission {
  readonly admit: (input: {
    readonly location: { readonly pathname: string };
    readonly snapshot: WorkspaceSnapshot | null;
  }) => NavigationVerdict;
}

/** Path chrome is not a port — shared helper (one adapter). */
export const chromeForPath = (pathname: string): AppChrome =>
  pathname === "/sign-in" ? { _tag: "Bare" } : { _tag: "Shell" };

/** Port B — may this host open inventory without an authenticated workspace? */
export interface GuestWorkspaceCapability {
  readonly allowLockedStore: boolean;
  readonly allowContinueOffline: boolean;
}

export const browserNavigation = (): NavigationAdmission => { /* wall */ };
export const desktopNavigation = (): NavigationAdmission => { /* open */ };

export const refuseGuestWorkspace = (): GuestWorkspaceCapability => ({
  allowLockedStore: false,
  allowContinueOffline: false,
});
export const allowGuestWorkspace = (): GuestWorkspaceCapability => ({
  allowLockedStore: true,
  allowContinueOffline: true,
});

/** Composition root only — not a deep module, a wiring checklist. */
export type HostAccessBundle = {
  readonly navigation: NavigationAdmission;
  readonly guest: GuestWorkspaceCapability;
};

export const browserHostAccess = (): HostAccessBundle => ({
  navigation: browserNavigation(),
  guest: refuseGuestWorkspace(),
});
export const desktopHostAccess = (): HostAccessBundle => ({
  navigation: desktopNavigation(),
  guest: allowGuestWorkspace(),
});
```

### Usage at call sites

```ts
// start-web.tsx
const access = browserHostAccess();
await startWebWorkspace(api, auth, { allowLockedStore: access.guest.allowLockedStore });
mountApp({ ..., access });

// start-electron.tsx
mountApp({ ..., access: desktopHostAccess() });

// __root
context.access.navigation.admit(...)
chromeForPath(pathname)  // not on access

// sign-in
access.guest.allowContinueOffline

// host.ts — unchanged consumer of allowLockedStore boolean
```

Tests can target `browserNavigation` and `refuseGuestWorkspace` independently; product tests still compose `browserHostAccess()`.

### What each implementation hides

- **Navigation adapters:** public paths, authenticated-workspace predicate, redirect targets
- **Guest capability adapters:** almost nothing (two booleans) — **shallow** unless deepened into `assertMayOpen(target)` that `host.ts` calls

Deeper store port (optional):

```ts
export interface GuestWorkspaceCapability {
  readonly assertMayOpen: (target: WorkspaceTarget) => void; // throws if Locked forbidden
  readonly allowContinueOffline: boolean;
}
```

Then `host.ts` stops owning the Locked error string; locality moves into the capability adapter.

### Trade-offs

| Lens | Assessment |
| --- | --- |
| **Depth** | Navigation port can be deep. Guest port is **shallow** as booleans; becomes deep only if it owns `assertMayOpen` / Locked refusal. Bundle at bootstrap is a **wiring seam**, not depth. |
| **Locality** | Good if navigation and store rules diverge. Bad if every product change edits both adapters and the bundle — change spreads. |
| **Seam placement** | Honest about two consumers (router vs workspace open). Over-split relative to today's lockstep browser/desktop pair. Chrome correctly **not** a port. |
| **Cost** | Callers learn two names (`navigation`, `guest`). Risk of illegal mixes unless only `browserHostAccess` / `desktopHostAccess` are exported and inner adapters stay package-private. |

---

## Comparison

**Depth.** Design 1 puts the most behavior behind the smallest runtime interface (`decide`). Design 2 maximizes caller leverage at bootstrap but risks a shallow host façade unless admission stays a deep inner module. Design 3 deepens navigation but leaves guest capability thin unless `assertMayOpen` is pulled in.

**Locality.** Design 1 concentrates the product sentence in one adapter pair. Design 2 concentrates bootstrap wiring; admission rules need an explicit inner home or they dissolve into factories. Design 3 splits locality along consumer lines (router vs store) — valuable only when those rules change independently.

**Seam placement.** Design 1 keeps the seam where auth-wall synthesis put it: inject one admission adapter at bootstrap, thread through router. Design 2 moves the seam up to "host runtime" (broader than admission). Design 3 adds an internal dual-port structure; the **external** seam should still be the composed bundle, or callers will assemble inconsistent policies.

**CONTEXT.md fit.** All three can speak in authenticated-workspace terms. Design 1 names the module after the decision (*admission*). Design 3's `GuestWorkspaceCapability` is the negation ("may run without authenticated workspace") — clear, but two ports for one product axis. Design 2 barely names the domain; it names the host.

**Fit to current code.** Today `chrome` does not justify a host port (Design 3 gets this right by demoting it). Today `allowLockedStore` and `allowContinueOffline` always move together (Design 1's `allowsGuestWorkspace` matches reality). `start-web`'s pluck of `allowLockedStore` is the main shallowness left in Candidate A as shipped.

---

## Recommendation (opinionated)

**Prefer Design 1 as the external interface, with a small graft from Design 3's chrome demotion and Design 2's bootstrap ergonomics.**

### Hybrid

1. **External module:** `AuthenticatedWorkspaceAdmission` with a single runtime entry `decide → WorkspaceAdmission` (Design 1). Adapters: `browserAdmission` / `desktopAdmission`.
2. **Rename the product bit** to something CONTEXT-aligned: `allowsGuestWorkspace` (or `allowsAbsentAuthenticatedWorkspace`) — one flag driving Locked open **and** continue-offline. Delete the parallel `signIn` nest and top-level `allowLockedStore` from the public interface.
3. **Chrome:** keep returning it from `decide` for caller convenience (Design 1), but implement it as a **shared path helper** inside the module (Design 3 insight) — do not pretend chrome varies by host.
4. **Do not** split navigation vs guest into separately injectable public ports (reject full Design 3 externally). Keep dual ports as **internal** structure only if tests want them; export only the composed adapters so illegal mixes are impossible.
5. **Bootstrap ergonomics (light Design 2):** add a tiny helper `guestWorkspaceAllowed(admission)` or have `startWebWorkspace` accept the admission module and read the flag internally — so `start-web` stops plucking fields. Stop short of `createBrowserHost` owning `mountApp` / OAuth; that widens the seam past admission and fails the deletion test for a *policy* module.
6. **`host.ts`:** keep taking a boolean **or** call a package-private `assertMayOpen` from the same module — either is fine; prefer pulling Locked refusal into admission's implementation if we want store tests at the same interface as navigation tests.

### Why not pure Design 2?

`AppHost` conflates admission depth with mount/workspace orchestration. Two adapters exist for **policy**, not for "how to call `mountApp`". A host factory would mostly pass through and make pure admission tests heavier.

### Why not pure Design 3?

Navigation and guest capability are one product axis today. Two public ports optimize for a divergence we do not have; they reintroduce the caller reassembly problem Design 1 removes, unless composition is sealed — at which point you have Design 1 with extra names.

### Success criteria for a later implementation pass

- `start-web` / `start-electron` / `__root` / sign-in never mention two guest booleans
- Browser cannot open Locked; desktop can — verified through the admission interface tests
- Routes stay host-blind
- Chrome path rules changeable without editing host adapter branches
- Module docs speak of **authenticated workspace admission**, not "session access" or "auth wall flags"
