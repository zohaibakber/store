---
name: verify-tabaaq
description: Drive the Tabaaq inventory web SPA the way a user does (sign-in, catalog, invoices, settings). Use when proving a UI change, reproducing a user-facing bug, or checking that a local run still works. Not for unit tests or Cloudflare deploy checks.
---

# Verify Tabaaq

Tabaaq is an offline-first inventory app. The surface this skill drives is the **web SPA** at `http://127.0.0.1:5174` (TanStack Router). Other surfaces exist and are out of scope unless a feature file says otherwise: Electron (`vp run dev:desktop`), Expo mobile, and the Cloudflare Worker API (`:8787`).

Browser and desktop hosts require an authenticated organization before any app route.

Read `features/README.md`, then the matching feature file, before driving.

## Launch

From the repository root:

```sh
.cursor/skills/verify-tabaaq/scripts/launch.sh
```

That starts `vp dev` in `apps/web` (Vite on `127.0.0.1:5174`, `strictPort: true`, `/api` proxied to `http://localhost:8787`). Ready when `GET http://127.0.0.1:5174` returns HTML with `<title>Tabaaq</title>` (the script waits up to ~30s). Log: `/tmp/tabaaq-verify/vite.log`. Pidfile: `/tmp/tabaaq-verify/vite.pid`.

Full stack (auth, inventory mutations, PowerSync) is `vp run dev:web` from the repo root. That needs gitignored `.env.dev`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. Alchemy binds real `dev`-stage D1, Hyperdrive, and Postgres; there is no local emulation. Prefer the SPA-only launch for sign-in-shell proofs. Use the full stack only when the feature file’s preconditions require a session.

Teardown is Cleanup below. Do not start a second Vite on 5174; the port is exclusive.

## Doctor

```sh
.cursor/skills/verify-tabaaq/scripts/doctor.sh
```

Require `spa ok title=Tabaaq`. If `pid=unknown`, this run did not start the instance — stop unless the operator named that process as the verification target. `api down` is acceptable for sign-in-shell features; it is a skip for any feature that signs in or mutates inventory.

## Drive

Harness: Cursor browser tools (navigate, snapshot, click, fill, screenshot). Prefer accessible names and labeled fields over CSS or coordinates.

Stable handles from this repo:

| What | Handle |
| --- | --- |
| Sign-in heading | heading `Sign in to Tabaaq` |
| Email | textbox labeled `Email` (`#auth-email`) |
| Continue | button `Continue` |
| Google | button `Continue with Google` |
| Password | textbox labeled `Password` (`#auth-password`) |
| Password submit | button `Sign in` |
| OTP | textbox labeled `One-time code` (`#auth-code`) |
| OTP submit | button `Verify` |
| Sidebar | links `Home` (`/`), `Products` (`/products`), `Invoices` (`/invoices`), `Settings` (`/settings`) |
| Products heading | `h1` `Products` |
| Add product | button/link `Add product` → `/products/new` |
| Import products | `Import` → `/products/upload` |
| New product form | `#new-product-form`, heading `Add product`, submit `Create product`, `Cancel` |
| Product name | field `Product name` |
| Invoices heading | `h1` `Invoices` |
| New sale | `New sale` → `/invoices/new` (`h1` `New sale`) |
| Settings | `/settings` redirects to `/settings/account` |

Start every recipe from `/sign-in` unless the feature file says the session is already admitted. Capture an ARIA snapshot after each navigation that matters.

## Evidence

Store proof under `.cursor/skills/verify-tabaaq/artifacts/<feature-id>/`. Cleanup must not delete that tree.

Proof standards:

- Exercise the real user path (click the same controls a user clicks). Do not call inventory APIs or PowerSync internals as a substitute for the UI.
- Capture the action and the resulting state (snapshot or screenshot of the heading plus the control you used), not only a later screen.
- For mutations, also prove persistence from a second user-facing view (list, detail, or reload).
- Side effects: a created product must reappear on `/products`; a sale must reappear on `/invoices`.
- Mocks only at production boundaries already isolated (Cloudflare/PowerSync). If those are down, skip authenticated features; do not fake a session in localStorage.

## Cleanup

```sh
.cursor/skills/verify-tabaaq/scripts/cleanup.sh
```

Kills only the pid (process group) recorded in `/tmp/tabaaq-verify/vite.pid`. Never `pkill` by name (`vite`, `electron`, `wrangler`). Leave `artifacts/` in place.

## Isolate

Vite binds `127.0.0.1:5174` with `strictPort: true`. Two SPAs cannot run side by side on the default port. If launch reports the URL already answers, refuse to drive that foreign instance. Auth cookies on that origin belong to whoever started it.

## Helpers

All scripts are executable:

```sh
.cursor/skills/verify-tabaaq/scripts/launch.sh
.cursor/skills/verify-tabaaq/scripts/doctor.sh
.cursor/skills/verify-tabaaq/scripts/cleanup.sh
```
