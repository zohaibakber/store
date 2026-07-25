# Plan 011: Give the renderer a real Content-Security-Policy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- apps/desktop/index.html apps/desktop/electron/main.ts apps/desktop/electron/auth.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a wrong policy visibly breaks the app — the steps include explicit runtime verification in dev AND packaged builds)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fe1891d6`, 2026-07-19

## Why this matters

The renderer loads with no Content-Security-Policy: `index.html` has no CSP
meta tag, `createWindow()` registers no header policy, and the only CSP
contribution comes from Better Auth's Electron helper, which merely adds
`connect-src` when no policy exists — it sets no `default-src`/`script-src`,
so script execution is unrestricted. Meanwhile the preload bridge exposes
auth (sign-in/out, org switching), the full offline store CRUD, and
authenticated server uploads to any script that runs in the page. CSP is the
standard defense-in-depth against injected script (a compromised npm
dependency, a future HTML-sink mistake); the window hardening that exists
(contextIsolation, sandbox, `nodeIntegration: false`, window-open deny) is
good but does not cover that scenario.

## Current state

- `apps/desktop/index.html:1-13` — full file today; no CSP meta (also note
  the boilerplate `<title>Vite + React + TS</title>` — leave the title alone,
  it's out of scope):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  ...
</html>
```

- `apps/desktop/electron/main.ts:319-335` — `createWindow()`:
  `webPreferences` = preload + `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`; `setWindowOpenHandler` denies;
  `will-navigate` guard. No `session`/`webRequest` CSP anywhere in the file
  (`grep -n "onHeadersReceived\|Content-Security" apps/desktop/electron/main.ts`
  → no matches).
- `apps/desktop/electron/auth.ts:82-84` —
  `setupMain() { this.#client.setupMain({ bridges: false, csp: true, scheme: false }); }`
  — the Better Auth helper injects `connect-src 'self' <apiOrigin>` into
  response headers ONLY when no CSP header exists. Once we set a real policy
  that already includes the API origin in `connect-src`, flip this to
  `csp: false` so two mechanisms don't fight.
- API origin at runtime: `main.ts:72-78` — `new AuthBroker(process.env["STORE_API_URL"] ?? process.env["VITE_API_URL"] ?? import.meta.env.VITE_API_URL ?? "http://localhost:8787", ...)`.
  The chosen origin is what `connect-src` must allow. Check how the broker
  exposes it (read `auth.ts` for a base-URL field; if none is public, derive
  the same expression in `main.ts` where the CSP string is built).
- Dev mode: `VITE_DEV_SERVER_URL` is used in `createWindow` (see
  `main.ts:336-345` region) — dev needs the Vite HMR websocket in
  `connect-src` and Vite's injected styles/scripts to keep working.
- Tailwind v4 and the React plugin inject `<style>` elements at runtime —
  `style-src` must include `'unsafe-inline'` (this is the standard Electron +
  Vite + Tailwind compromise; do not attempt nonces in this plan).
- PGlite runs in the MAIN process, not the renderer — no `wasm-unsafe-eval`
  should be needed. If the packaged app proves otherwise, that's a STOP
  condition (investigate what in the renderer needs WASM before adding it).

## Commands you will need

| Purpose        | Command                                                 | Expected on success                                             |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Install        | `vp install`                                            | exit 0                                                          |
| Check          | `vp check`                                              | no NEW failures                                                 |
| Tests          | `vp test`                                               | all pass                                                        |
| Run dev app    | `vp run dev` (root) or `cd apps/desktop && bun run dev` | Electron window opens, app usable                               |
| Packaged build | `cd apps/desktop && bun run build`                      | electron-builder completes; artifact in `apps/desktop/release/` |

## Scope

**In scope** (the only files you should modify):

- `apps/desktop/index.html` (CSP meta tag)
- `apps/desktop/electron/main.ts` (header-level CSP via `onHeadersReceived`)
- `apps/desktop/electron/auth.ts` (only the `csp: true` → `csp: false` flag, and only if Step 3 confirms the flip is safe)

**Out of scope** (do NOT touch):

- `preload.ts`, the bridge surface, `webPreferences` — already hardened.
- The `will-navigate` guard (separate backlog finding SEC-03).
- `vite.config.ts`, Tailwind config, any renderer source.

## Git workflow

- Branch: `advisor/011-renderer-csp`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the policy string in `main.ts`

Near the `AuthBroker` construction (which already computes the API base
URL), define:

```ts
const apiOrigin = new URL(/* the same base-URL expression the AuthBroker receives */).origin;
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${VITE_DEV_SERVER_URL ? " ws: http://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");
```

Register it once, before `createWindow()` is first called:

```ts
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": [csp],
    },
  });
});
```

(`session` imported from `electron`. Registration must happen after
`app.whenReady()` — put it wherever `createWindow` is scheduled; read the
app-ready wiring at the bottom of `main.ts` first.)

**Verify**: `vp check` → no new errors.

### Step 2: Add the meta fallback for `file://` loads

`webRequest.onHeadersReceived` does not reliably fire for `file://`
navigations in packaged builds, so add the same policy as a meta tag in
`index.html` `<head>` (meta CSP cannot use `frame-ancestors` — omit it
there):

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'"
/>
```

Note the meta policy's `connect-src 'self' https:` is looser than the header
policy (the API origin is not known at HTML-build time). The header policy —
which IS origin-pinned — still applies wherever headers exist; the meta is
the floor, not the ceiling. Add a one-line HTML comment saying exactly that.

Dev caveat: Vite serves over http with an HMR websocket. If the meta policy
breaks dev (blank window, console CSP violations for `ws://localhost`), the
accepted solution is to inject the meta only for production HTML via the
existing Vite tooling — check `apps/desktop/vite.config.ts` for an HTML
transform hook; if none is trivially available, keep the meta permissive
enough for dev (`connect-src 'self' https: ws: http://localhost:*`) and note
it in the PR description. Do not install new plugins for this.

**Verify (dev)**: launch the dev app. Confirm: window renders, sign-in page
appears, DevTools console shows NO CSP violation errors during normal
navigation (products list, invoices list). Screenshot or paste the console
state in your report.

### Step 3: Reconcile with Better Auth's CSP flag

Read `node_modules/@better-auth/electron/dist/client.mjs` around its
`setupMain` CSP handling to confirm what `csp: true` does in the presence of
an existing policy (at planning time: it only ADDS `connect-src` when no CSP
header exists). If our header policy already includes the API origin in
`connect-src`, flip `auth.ts:83` to `csp: false`. If the helper does
something more (e.g. also patches the auth popup/session requests), leave
`csp: true` and instead confirm the two policies compose (the browser
enforces the intersection — strictest wins; verify sign-in still works).

**Verify**: sign-in and sign-out work in the dev app; an authenticated
request to the API succeeds (e.g. organization switch), proving
`connect-src` admits the API origin.

### Step 4: Packaged verification

Build the packaged app (`cd apps/desktop && bun run build` — do NOT run
`release`, which publishes). Launch the artifact from
`apps/desktop/release/` (`.AppImage` on Linux). Confirm the app renders, the
store loads, and — with DevTools if accessible, otherwise by exercising every
main surface (products, invoices, settings, upload page) — nothing is
CSP-blocked.

**Verify**: `vp test` → all pass (no renderer tests exist; this guards the
main-process compile), plus the manual packaged check above, reported
explicitly.

## Test plan

No automated renderer harness exists (known backlog gap TEST-01/TEST-04), so
verification is the explicit dev + packaged runtime checks in Steps 2–4.
State in your final report exactly which surfaces you exercised in each mode.

## Done criteria

Machine-checkable where possible. ALL must hold:

- [ ] `grep -c "Content-Security-Policy" apps/desktop/index.html` → 1
- [ ] `grep -n "onHeadersReceived" apps/desktop/electron/main.ts` → exactly one registration
- [ ] `vp check` — no new failures; `vp test` exits 0
- [ ] Dev app runs with zero CSP-violation console errors across sign-in, products, invoices, upload pages
- [ ] Packaged build (`bun run build`) launches and all main surfaces work
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The packaged app breaks in a way that seems to require `'unsafe-eval'`,
  `'wasm-unsafe-eval'`, or relaxing `script-src` — report WHAT was blocked
  (the console violation line) instead of loosening the policy.
- Better Auth's helper turns out to require its own CSP mutation to keep
  sessions working and `csp: false` breaks sign-in — revert the flag, keep
  the header policy, and report the interaction.
- You cannot launch/verify the packaged build in this environment (e.g. no
  display) — deliver the code changes with dev-mode verification complete and
  report the packaged check as NOT DONE rather than claiming it.

## Maintenance notes

- Any future feature loading remote content (images from a CDN, external
  fonts, new API origins) must extend the CSP deliberately — reviewers
  should treat CSP edits as security-sensitive.
- If a renderer test harness lands (backlog TEST-01/TEST-04), add an assert
  that `index.html` contains the CSP meta so it can't be silently dropped.
- The unsigned-updates finding (SEC-02, backlog) is the other half of the
  desktop supply-chain story; CSP does not mitigate it.
