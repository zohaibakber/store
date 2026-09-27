# Expo Android app (`apps/mobile`)

Status: Phase 0 recorded 2026-09-24; screen map and scan flow awaiting sign-off. No app code exists yet. Parent plans: [authority plan](./planetscale-postgres-expo-sync.md) section 9, [status](./sync-migration-status.md) sequence item 6.

Android only. The app is a full replica (SQLite, durable outbox, offline commits) built around one loop: scan, review, commit.

## Phase 0: stack resolution

Checked against npm and the Expo changelog on 2026-09-24. `expo@next` is `58.0.0-preview.6`; the SDK 58 beta started 2026-09-10. `expo@latest` is 57.0.24.

| Area                                             | Pin                                      | Notes                                                                                                         |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `expo`                                           | `58.0.0-preview.6`                       | New Architecture only. compileSdk 37, targetSdk 36, minSdk 24. Node `^22.13 \|\| ^24.3`                       |
| `react` / `react-native`                         | `19.3.0` / `0.88.0-rc.1`                 | Same React as desktop, so one React per bundle is easy to keep                                                |
| `expo-router`                                    | `~58.0.7`                                | `expo-router/native-tabs` is stable in 58 and renders Material 3 bottom navigation                            |
| `@expo/ui`                                       | `~58.0.6`                                | Jetpack Compose `Host`, `Button`, `BottomSheet` stable since 56; other components to be checked per component |
| `expo-sqlite`                                    | `~58.0.5`                                | libSQL options removed in 58                                                                                  |
| `expo-secure-store`                              | `~58.0.0`                                | Refresh token storage                                                                                         |
| `expo-dev-client`                                | `~58.0.6`                                | Required: camera OCR needs native modules, Expo Go is out                                                     |
| `expo-crypto`                                    | `~58.0.2`                                | `getRandomValues`/`randomUUID` for Effect and command IDs on Hermes                                           |
| `expo-network`, `expo-background-task`           | `~58.0.1`, `~58.0.6`                     | Scheduler wake signals; opportunistic catch-up                                                                |
| `expo-font`, `expo-haptics`, `expo-image`        | `~58.0.2`, `~58.0.1`, `~58.0.5`          | Inter via config plugin; capture/commit haptics                                                               |
| `expo-build-properties`                          | `~58.0.6`                                |                                                                                                               |
| Reanimated / Worklets                            | `4.6.0` / `0.12.2`                       | Frame-processor worklets and state motion                                                                     |
| Gesture handler / screens / safe area            | `~3.2.1` / `~4.28.0` / `~5.9.1`          |                                                                                                               |
| `@shopify/flash-list`                            | `2.0.2`                                  | Stock and batch lists                                                                                         |
| Camera                                           | `react-native-vision-camera@5.2.3`       | Nitro, New Architecture only, no bundled config plugin (prebuild setup)                                       |
| On-device text recognition                       | `react-native-vision-camera-mlkit@2.0.1` | ML Kit frame processor for VisionCamera 5, ships an Expo config plugin (built against config-plugins 57)      |
| `@hugeicons/react`, `@hugeicons/core-free-icons` | desktop pins                             | Needs `react-native-svg@15.15.5`                                                                              |
| `eas-cli`                                        | `24.7.0`                                 | Local iteration with `expo run:android`; `eas build --local` for release-shaped artifacts                     |

Effect stays on the `4.0.0-rc.117` catalog pin; no RC newer than 117 is published.

Camera choice: VisionCamera 5 with the ML Kit frame processor is the only option that recognises text continuously from the preview stream, which batch auto-capture needs. `expo-camera` with `@react-native-ml-kit/text-recognition` only works on captured stills and is the fallback if VisionCamera 5 fails on RN 0.88. Expo SDK 58 ships no first-party text recognition.

### Replica driver: decision needed

`packages/sync` opens its SQLite store through `@effect/sql-sqlite-node` and `drizzle-orm/effect-sqlite-node` (`packages/sync/src/replica/storage.ts`). Everything past that point only needs a Drizzle database over an Effect `SqlClient`. Two ways to give mobile the same shape:

1. `@effect/sql-sqlite-react-native@4.0.0-rc.117` over `@op-engineering/op-sqlite@17.2.0` (inside its `>=17.1.2 <18` peer range; op-sqlite latest is 18.2.5). This is the published Effect client. Drizzle rc.5 has no `effect-sqlite-react-native` driver, so a thin driver mirroring `effect-sqlite-bun` is still needed. op-sqlite 17 against RN 0.88 is unverified.
2. `expo-sqlite` with a small Effect `SqlClient` over its async API and `withExclusiveTransactionAsync`, plus the same thin Drizzle driver. This is the path the authority plan named, but the `SqlClient` is written by hand.

Recommendation: option 1, if a dev build proves op-sqlite 17 on RN 0.88; otherwise option 2.

### Hermes and platform notes

- Polyfill `crypto.getRandomValues`/`randomUUID` through `expo-crypto`; check `structuredClone` and `AbortSignal.timeout` under Effect rc.117 on Hermes in the first slice.
- pnpm isolated `node_modules` is supported by Expo since SDK 54. Keep `nodeLinker` unset.
- `packages/sync`'s Web Locks ownership (`web-ownership.ts`) is browser-only. Mobile is a single process and owns the network unconditionally.
- Auth: `googleNative` ID-token exchange already exists in `apps/auth`; `com.tabaaq.mobile://` and `com.tabaaq.mobile.debug://` are default trusted redirects. Tokens go in SecureStore as bearer tokens.
- No Kotlin, Gradle, or `apps/android` files remain; `scripts/check-retired-vendors.mjs` guards `apps/android`. Preserve application id `com.tabaaq.mobile`.
- This machine has the Android SDK and NDK but no emulator package or system image, and no device is attached.

### Server contract gaps found

- `ProductScanResult` carries one overall `confidence`. Per-field review highlighting is derived on the device: a field is flagged when it is empty, or when its value does not appear in the recognised text (for example, expiry normalised from `EXP 08/27`).
- The Cloudflare rate-limit binding returns only `success`. The client cannot know the remaining budget, so the UI shows a rate-limited state only after a 429 and uses `Retry-After` if the server adds it (30 scans per 60 s per user).

## Screen map

Bottom navigation (native tabs, Material 3): **Stock**, **Sales**, **Sync**. An extended FAB, **Scan**, sits on Stock and Sales. Settings opens from the account avatar in the Stock top bar.

| Route                               | Purpose                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `(auth)/sign-in`                    | Google (native) or email; organization pick                                   |
| `(tabs)/stock`                      | Search-first stock list, low-stock and expiring filters, pending markers      |
| `stock/[productId]`                 | Batches, stock movements, adjust stock                                        |
| `scan` (full-screen modal)          | Camera, Product/Batch mode, manual entry                                      |
| `scan/review`                       | Product review: match to existing product, fields, commit                     |
| `scan/batch`                        | Batch review list; commit ready rows, keep rows that need checking            |
| `scan/drafts`                       | Scans saved offline and waiting for auto-fill                                 |
| `(tabs)/sales`, `sales/[invoiceId]` | Invoice history and detail (issuing a sale stays on desktop for this release) |
| `(tabs)/sync`                       | Outbox: pending, rejected (with reason and fix), last pull, storage errors    |
| `settings`                          | Account, organization, sign out                                               |

## Scan flow

1. Open Scan: the camera binds while the modal animates in; target is under 1 s to first preview frame on a mid-range device. The text recogniser runs on preview frames and outlines detected blocks.
2. Capture. Product mode: shutter or a stable frame. Batch mode: auto-capture when blocks are stable, with a haptic, then a thumbnail joins the tray. The photo and recognised text are saved to SQLite at capture, so nothing is lost if parsing fails.
3. Parse: `POST /api/product-scans` with the recognised text. The sheet shows three steps: text found, fields parsed, catalog match (local SQL).
4. Review: the local catalog match decides between "add a batch" and "new product". Flagged fields have a highlighter fill. The commit button names the exact effect ("Add 12 packs to Panadol Extra").
5. Commit: build `catalogWrite` rows with the shared projection helpers and enqueue through the sync engine. It is saved locally at once and syncs through the outbox.

Recoverable states:

| State               | Behaviour                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Offline             | The draft keeps the photo and text. The user fills fields by tapping recognised text chips, or saves the draft to auto-fill later |
| Rate limited (429)  | The draft is kept, with a countdown. "Fill in by hand" is always available. Batch mode pauses parsing but keeps capturing         |
| Parse failed (502)  | One retry action, then manual fill, with the same draft kept                                                                      |
| Low confidence      | Overall `confidence` below 0.6 opens review with every derived field flagged and the recognised text expanded                     |
| Rejected after sync | Shown in Sync with the rejection reason and a "fix and resend" path, which creates a new command                                  |

Wireframes live in Paper, in the file "Nimble rose": 01 Scan (product), 02 Parsing, 03 Review (product), 04 Scan (batch), 05 Review (batch), 06 Offline fill (partial). Stock, product detail, rate limited, and Sync are not drawn yet; Paper's weekly MCP quota ran out.

## Build order after sign-off

1. App shell, dev build, auth (Google native and email) against the dev backend.
2. Replica: the chosen SQLite driver behind `ReplicaStore`, migrations, scheduler wired to AppState and network, Stock list over TanStack DB.
3. Scan to review to commit, with drafts, offline commit, and later sync.
4. Product detail, Sales, Sync, and Settings.

## Effect v4 RC AI for scan parsing: defer

`effect@4.0.0-rc.117` ships `effect/unstable/ai` (`LanguageModel.generateObject`, `Prompt`, `Toolkit`, and `Decision`/`DecisionModel` added in rc.116). No provider wraps the Workers AI binding: `@effect/ai-openai`, `-anthropic`, and `-openrouter` have rc.117 builds; `@effect/ai-google` has none, and there is no Cloudflare provider. Adopting it means rewriting `apps/server/src/ai/workers-ai.ts` as a `LanguageModel.make` provider of about the same size. The AI modules also changed incompatibly within this RC window (rc.113). The scan path already has a span, a swappable `ProductScanAiClient` for tests, and a 15 s timeout. `generateObject` would not replace the OCR-specific normalisation in `packages/services/src/product-scan/service.ts`. Revisit when Effect 4 is stable and a binding-native provider exists. `ExecutionPlan` for a fallback model is usable today if a second model is wanted.

## Build contract (2026-09-24)

Signed off: the recommended options above (op-sqlite driver, screen map, scan flow, Effect AI deferred). Five slices build in parallel against the interfaces below. Each slice owns only its listed paths; anything outside needs a note to the orchestrator.

### Conventions for every slice

- Read `AGENTS.md`, `.agents/skills/coding-standards/SKILL.md`, and `.agents/skills/effect/SKILL.md`. No code comments in source or tests except `// SAFETY:` immediately before every `as` cast. Prefer Effect, Expo, and library APIs over hand-rolled retry loops, event emitters, JSON parsing of protocol data, or pooling.
- UI: read `.agents/skills/expo-ui/SKILL.md` (and `references/jetpack-compose.md`, `references/universal.md`), `.agents/skills/expo-native-ui/SKILL.md`, and the matching rules in `.agents/skills/vercel-react-native-skills/rules/`. Prefer `@expo/ui` (universal first, then `@expo/ui/jetpack-compose` in files outside `src/app`) for controls, list items in bounded lists, sheets, text fields, chips, segmented buttons, and switches. Use `@shopify/flash-list` with plain React Native rows for unbounded lists (stock, invoices), styled to match Material list items. Confirm prop shapes from the installed `.d.ts` files, not memory.
- Design: tokens in `apps/mobile/src/theme/tokens.ts`; text through `@/ui/text`; icons through `@/ui/icon` (Hugeicons). Inter 400/500 only; sizes 12/14/16/18/24; touch targets at least 48; the highlighter colour is only a fill behind ink text, marking what needs the user's attention. Motion only for capture, parsing, and commit state. Light theme only.
- Android: edge-to-edge insets via `react-native-safe-area-context`; predictive back is enabled; no iOS work.
- Tests: Vitest under `apps/mobile/test` for pure logic (no native modules); package tests stay in their package.

### Slices and ownership

| Slice              | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                               | Provides                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Shared inventory | `packages/inventory-react/**` (new), `apps/desktop/src/lib/inventory/**`, `apps/desktop/src/lib/inventory-host.ts`, desktop tests that import them                                                                                                                                                                                                                                                                                                 | Platform-neutral `openInventoryWorkspace`, `InventoryProvider`, `InventoryHost`, actions, atoms, queries, sync status model moved from desktop; desktop re-imports them unchanged in behaviour. Adds `createProductWithBatch` (one atomic `catalogWrite` with a product upsert and a batch upsert) and `receiveBatch` (batch upsert for an existing product) to `InventoryActions`, and a `useCatalogProductSearch(query, limit)` hook |
| 2 Native replica   | `packages/sync/src/sql-client.ts` (new `./sql-client` export: the replica store over any Effect `SqlClient` with a thin Drizzle session built from `drizzle-orm/sqlite-core/effect`, no native imports), `packages/client-db/src/replica/sql-client*.ts` (new export), a boundary test proving `@store/sync`, `@store/sync/browser`, and `@store/sync/sql-client` never import op-sqlite or `@effect/sql-sqlite-*`, `apps/mobile/src/inventory/**` | `MobileInventoryProvider`: builds the client with `@effect/sql-sqlite-react-native` on op-sqlite inside the app, opens the replica for the signed-in session, syncs over HTTP with the session's `authenticatedFetch`, wakes the scheduler from AppState and `expo-network`, and wraps `@store/inventory-react`'s provider                                                                                                             |
| 3 Auth             | `apps/mobile/src/auth/**`, `apps/mobile/src/app/(auth)/**`                                                                                                                                                                                                                                                                                                                                                                                         | `AuthProvider`, `useSession()` with the `Session` type in `src/auth/session.ts`; email + OTP and native Google sign-in against `apps/auth`; bearer tokens in SecureStore; refresh; organization pick                                                                                                                                                                                                                                   |
| 4 Scan             | `apps/mobile/src/scan/**`, `apps/mobile/src/app/scan/**`                                                                                                                                                                                                                                                                                                                                                                                           | Camera (VisionCamera 5 + ML Kit frame processor), drafts persisted at capture, parse client for `POST /api/product-scans`, parsing sheet, product and batch review, offline fill from text chips, rate-limited and failed states, commit through `createProductWithBatch` / `receiveBatch`                                                                                                                                             |
| 5 Screens          | `apps/mobile/src/app/(tabs)/**`, `apps/mobile/src/app/stock/**`, `apps/mobile/src/app/sales/**`, `apps/mobile/src/app/settings.tsx`, `apps/mobile/src/features/**`                                                                                                                                                                                                                                                                                 | Native tabs Stock / Sales / Sync, Scan extended FAB, stock list, product detail with batches and movements, invoices, outbox and sync health, settings                                                                                                                                                                                                                                                                                 |

Native SQLite dependencies live only in `apps/mobile`. Adding op-sqlite next to `drizzle-orm` in a shared package changes the peer set pnpm auto-installs and duplicates Drizzle's types.

The orchestrator owns `apps/mobile/{package.json,app.config.ts,metro.config.js,tsconfig.json}`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/theme/**`, `apps/mobile/src/ui/**`, `pnpm-workspace.yaml`, and the lockfile. Slices that need a new dependency ask for it in their report instead of installing it.
