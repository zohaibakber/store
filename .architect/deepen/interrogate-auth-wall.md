# Interrogate: web-only auth wall (`HostAccessPolicy`)

**Scope:** Readonly adversarial review of the implemented wall  
(`host-access.ts`, bootstrap, `__root` dual admit, Locked refuse).  
**Intent claimed:** Browser signed-out cannot use inventory; desktop stays
signed-out / offline / Locked; policy injected at bootstrap (not
`VITE_ELECTRON` per route).

**Verdict in one line:** The adapter injection is the right *seam choice*, but
the live-session wiring is unfinished — frozen `initialAuth` + effect-side
admit is a paper wall, and grafting `allowLockedStore` onto the same interface
reintroduced the sprawl Candidate A claimed to kill.

---

## Challenge answers (short)

| # | Challenge | Answer |
| --- | --- | --- |
| 1 | Deep enough or shallow sprawl? | **Still shallow at the boundary.** `admit` is decision-shaped; `chrome` / `signIn` / `allowLockedStore` are three more knobs callers must know. Locked capability does not belong beside navigation verdicts. |
| 2 | Dual admit race/flash/deep-link? | **Yes.** `beforeLoad` + root `useEffect` (+ sign-in route effect + `finishSignedIn`) can disagree; Loading-with-stale-snapshot paints shell; deep links are replaced away with no return URL. |
| 3 | Does `invalidate` fix frozen `initialAuth`? | **No.** `router.invalidate()` re-runs `beforeLoad` against the **same** context object. Live truth only reaches the effect path. |
| 4 | `allowLockedStore` on access module? | **Seam confusion.** Navigation policy and workspace-open capability share one type; desktop’s flag is unused; web still threads a boolean through `startWeb` → `host.ts`. |
| 5 | Simpler shapes? | Put **one** live snapshot on router context and admit only in `beforeLoad`; split or fold Locked refuse outside `HostAccessPolicy`; delete the effect and the sign-in duplicate redirect. |

---

## Ranked findings

### BLOCKER — Frozen `initialAuth` makes `beforeLoad` lie after any session change

**Evidence**

- `__root` `beforeLoad` always reads `context.initialAuth` (`routes/__root.tsx`).
- That value is set once in `getRouter` / `mountApp` and never rewritten.
- `AuthProvider.apply` on scope change calls `router.invalidate()` (sign-in) or
  `router.clearCache()` (sign-out) (`lib/auth.tsx`) — neither updates
  `context.initialAuth`.
- Candidate A already flagged this as an open question (“live snapshot into
  router context”); the implementation shipped the comment, not the fix, and
  bolted on a `useEffect` admit instead.

**Why it bites**

1. **Cold start OK:** bootstrap snapshot matches `initialAuth` → first paint wall works.
2. **After sign-in:** `invalidate` re-admits with *unsigned* frozen snapshot. A
   navigation to `/` (from `AuthForm.finishSignedIn` or the effect) can
   `Redirect` back to `/sign-in` while live auth is already authenticated →
   bounce / flash until the effect wins.
3. **After sign-out:** `beforeLoad` still sees *authenticated* frozen snapshot →
   `Allow` for `/products` etc. Only the effect redirects. Any navigation or
   loader that runs on the stale Allow sees a torn-down store
   (`AuthenticatedWorkspace` disposed Locked/Authenticated store).
4. Claiming “invalidate keeps beforeLoad honest” is false. Invalidate refreshes
  *loaders*, not *bootstrap context*.

**Remediation**

- Keep a mutable live snapshot on router context, e.g. update in `apply`:

  ```ts
  router.update({
    context: (prev) => ({
      ...prev,
      session: { snapshot: next }, // or replace initialAuth
    }),
  });
  await router.invalidate();
  ```

- `beforeLoad` must admit from **that** field only.
- Delete the root `useEffect` admit once `beforeLoad` is live (see High #2).
- Add a regression test: mount router with unsigned `initialAuth`, simulate
  `apply(authenticated)`, `invalidate`, navigate to `/` — expect `Allow`, not
  bounce to `/sign-in`.

---

### BLOCKER — Unsigned web Locked refuse is modeled as `workspaceError`

**Evidence**

- Browser policy: `allowLockedStore: false` → `host.ts` `open` throws
  `"Sign in to open this workspace."` on `Locked`.
- `AuthenticatedWorkspace.#activate` on any open failure publishes
  `unauthenticated(isOnline, message)` **with that message as
  `workspaceError`**, then throws (`packages/workspace/.../workspace.ts`).
- `initialize` swallows the throw and returns `#snapshot` → every unsigned web
  cold start yields a Session whose `workspaceError` is the policy refusal.
- `AuthProvider` treats `initial.snapshot.workspaceError` as `error` → auth
  boots in `_tag: "Error"` for the normal signed-out browser case.

**Why it bites**

- Expected product behavior (no guest DB) is indistinguishable from a real
  workspace failure.
- Any future UI that surfaces `auth.error` / `workspaceError` will scare unsigned
  users on every visit.
- `#recoverLocked` on authenticated-open failure also tries Locked and will
  fail the same way on web — leaving **no** store and another error publish.
  That may be desired, but it is accidental coupling, not an explicit “idle
  until Authenticated” state.

**Remediation**

- Do not open Locked on web at all: short-circuit in `#activate` / adapter when
  capability says guest inventory is forbidden — publish clean unauthenticated
  **without** `workspaceError`, leave `#store` undefined (or an explicit Idle
  target).
- Or catch the policy refusal in `startWebWorkspace` / `open` and map it to a
  non-error idle snapshot before `bootstrapAuth`.
- Reserve `workspaceError` for unexpected failures only.
- Test: unsigned `startWebWorkspace({ allowLockedStore: false })` → snapshot
  unauthenticated, `workspaceError == null`, `runStore` still rejects until
  sign-in.

---

### HIGH — Dual (really quadruple) admit: race, flash, deep-link loss

**Evidence**

| Path | When | Snapshot source |
| --- | --- | --- |
| `__root` `beforeLoad` | every matched navigation | frozen `initialAuth` |
| `AuthenticatedLayout` `useEffect` | after paint, deps on live auth | `useAuth().snapshot` |
| `routes/sign-in.tsx` `useEffect` | sign-in only | live auth again |
| `AuthForm.finishSignedIn` | after password/OTP/register | imperative `navigate("/")` |

**Concrete bugs**

1. **Flash / stale shell:** Effect guard is
   `Loading && !snapshot → AppLoading`. During sign-out, `loading` is true but
   **old authenticated snapshot remains** until `apply` finishes → Shell +
   Outlet stay mounted over a disposing store.
2. **Post-auth bounce:** Form navigates to `/` while `beforeLoad` still denies
   (frozen unsigned) → redirect `/sign-in` → live effect redirects `/` again.
3. **Deep links discarded:** Unsigned `/products/$id` →
   `Redirect { to: "/sign-in", replace: true }` with no `search` / return URL.
   Post-login always lands on `/` (form) or whatever the effect chooses.
   Synthesis rejected Candidate B partly to *preserve* deep-link / post-auth
   URL behavior — this implementation does not.
4. **Redundant sign-in effect:** Duplicates policy that `admit` already encodes
   for authenticated `/sign-in` → third source of truth.

**Remediation**

- Single gate: live snapshot in context + `beforeLoad` only.
- Remove root effect admit and `sign-in.tsx` authenticated redirect once
  `beforeLoad` is correct.
- Extend `AccessVerdict` Redirect (or location) with optional `redirect`
  / return path: unsigned deep link → `/sign-in?next=…`; after auth,
  `admit` or finish handler restores it.
- While Loading across an auth-scope transition, force `AppLoading` (ignore
  stale snapshot) so Shell cannot paint protected chrome mid-teardown.

---

### HIGH — `HostAccessPolicy` is still a bag of host facts (shallow sprawl)

**Evidence**

Public surface today:

```ts
admit | chrome | signIn.allowContinueOffline | allowLockedStore
```

- `chrome` re-asks “is this public?” — same private `PUBLIC_PATHS` `admit`
  already uses. Callers must know two methods for one location.
- `signIn.allowContinueOffline` is a UI affordance copy of “guest inventory
  allowed” — the same bit as `allowLockedStore` on both adapters (always
  equal in `browserHostAccess` / `desktopHostAccess`).
- `allowLockedStore` was **not** in Candidate A’s interface; synthesis grafted
  Locked refuse onto the navigation policy. `start-web` still destructures a
  boolean into `startWebWorkspace`. Desktop adapter sets
  `allowLockedStore: true` but Electron never reads it (`electronStore` /
  main process owns Locked).

**Interrogation**

Candidate A’s depth claim was: callers learn three facts; deleting the module
re-scatters rules. After the graft, callers learn **four**, two of which are
the same capability under different names, and one of which is dead on desktop.
That is flag sprawl with a verdict-shaped hat.

**Remediation (pick one deep shape)**

1. **Split seams (clearest):**  
   - `HostAccessPolicy`: `admit` + maybe chrome derived inside.  
   - `HostWorkspaceCapability` / option on `startWebWorkspace` only: guest
     inventory. Desktop never sees it in the renderer policy.
2. **One capability, many projections (deeper module):**  
   `HostProfile { guestInventory: boolean }` privately derives
   `admit` rules, `allowContinueOffline`, and Locked open — **do not** export
   three booleans. Routes only see `admit` (+ chrome if still needed).
3. **Collapse chrome into location classification inside `admit`’s module** —
   keep `chrome()` if Bare/Shell must stay out of redirects, but stop teaching
   callers a second public-path API; or return chrome from a single
   `surface(location)` used only by `__root`.

Do **not** add more fields (`requireAuth`, `hostKind`, …) when the next host
quirk appears — extend adapters behind one decision entry.

---

### HIGH — Deep-link / OAuth return path not part of the policy

**Evidence**

- `AccessLocation` is `{ pathname }` only.
- Browser OAuth: `completeGoogle(location.href)` runs **before** `mountApp`
  (`start-web.tsx`) — good for adopting tokens — but the wall still does not
  model post-auth return.
- No tests for “unsigned user opened `/products/x` → after sign-in back to
  `/products/x`”.

**Remediation**

- Encode return URL in the Redirect verdict or in sign-in search params as part
  of `admit`, not ad-hoc in `AuthForm`.
- Ensure OAuth and password paths share the same restore helper.
- Keep hash/query out of “public path” checks unless you deliberately allow
  callback routes as Bare.

---

### MEDIUM — Tests prove the adapter table, not the wall

**Evidence**

`test/host-access.test.ts` checks verdicts + the two booleans. Missing:

- `__root` beforeLoad with frozen vs updated context
- effect vs beforeLoad disagreement
- Locked open refusal → clean unauthenticated snapshot
- no `workspaceError` on expected guest deny
- deep-link `next` preservation (once added)

**Remediation**

- Keep pure adapter tests (good).
- Add router-context / `AuthProvider.apply` integration tests for the BLOCKER
  invalidate story.
- Add workspace adapter unit test for `allowLockedStore: false`.

---

### MEDIUM — Simpler shapes that delete complexity

Ranked by how much they remove:

1. **Live session on router context + admit only in `beforeLoad`**  
   Deletes: root `useEffect` admit, sign-in duplicate effect, most bounce bugs.
2. **Hardcode web Locked refuse in `startWebWorkspace` / `makeWorkspaceStores`**  
   Deletes: `allowLockedStore` on `HostAccessPolicy`, the pass-through in
   `start-web`, and the fake symmetry on `desktopHostAccess`. Policy stays
   navigation-only (Candidate A as drawn).
3. **Single `guestInventory` capability driving UI + store**  
   Deletes: parallel `allowContinueOffline` / `allowLockedStore` twins.
4. **Idle workspace target instead of throw-on-Locked**  
   Deletes: error-shaped unsigned bootstrap (BLOCKER #2) and
   `#recoverLocked` surprise on web.

Avoid: going back to per-route `VITE_ELECTRON`, or Candidate B’s unmount-the-
router shell (synthesis already rejected that for deep-link reasons — ironic
given deep links are broken here too).

---

## What is actually solid

- Bootstrap injection (`start-web` / `start-electron` → `mountApp` → router
  context) is the correct host seam; leaf routes stay blind; no new
  `VITE_ELECTRON` in `beforeLoad`.
- `admit` as a pure verdict (route throws `redirect`) is the right shape for
  navigation.
- Grafting *some* Locked refuse on web is the right *product* instinct
  (navigation-only wall would leave `tabaaq-locked` serving data) — the miss is
  packaging and error modeling, not the intent.
- Desktop `admit` still allows unsigned inventory; sign-in offline affordance
  gated — matches the stated product split.

---

## Suggested fix order

1. Fix live snapshot → router context; admit only in `beforeLoad` (BLOCKER + HIGH dual-admit).
2. Make unsigned web Locked deny a clean idle snapshot (BLOCKER workspaceError).
3. Collapse or split `allowLockedStore` / `allowContinueOffline` (HIGH sprawl).
4. Preserve return URLs in Redirect / sign-in (HIGH deep-link).
5. Expand tests to the wiring, not only the verdict table (MEDIUM).

Until (1) and (2) land, treat the wall as **demo-correct on cold start** and
**incorrect across session transitions**.
