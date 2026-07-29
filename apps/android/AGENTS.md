# apps/android

Native Android (Kotlin + Jetpack Compose) app generated in Google AI Studio.
It scans product/medicine labels on-device (ML Kit OCR) and uses the Gemini
API to parse the raw text into structured fields, storing them in a local
SQLCipher-encrypted Room database.

## Why this lives in two places

The canonical remote for this app is
[github.com/zohaibakber/android-app](https://github.com/zohaibakber/android-app) —
that's the repo AI Studio's remote build/emulator watches, and it's currently
the only way to see this app running (no Android SDK/emulator is installed
locally in this environment).

This directory is a **git subtree** import of that repo into the monorepo, so
its code can be edited alongside the desktop app and kept aligned with the
shared data model and design system. It is not a submodule — the files are
committed directly into this repo's history.

To push local edits back to the AI Studio-watched repo so the remote emulator
picks them up:

```sh
git subtree push --prefix=apps/android android-app-remote main
```

(`android-app-remote` is the git remote pointing at
`https://github.com/zohaibakber/android-app.git`; add it with
`git remote add android-app-remote https://github.com/zohaibakber/android-app.git`
if it isn't configured.)

To pull upstream changes made directly in AI Studio back into the monorepo:

```sh
git subtree pull --prefix=apps/android android-app-remote main
```

## Data model and sync

`app/src/main/java/com/example/data/` mirrors the `products` + `batches`
tables in `packages/db/src/shared/store.schema.ts` (name, category,
composition, strength, batch number, `expiresAt` as epoch millis, unit/pack
quantity). `id`/`productId` are client-generated UUIDs (not Room
autoincrement) so they're stable across devices once synced.

This is now wired into the real sync pipeline:

- `app/src/main/java/com/example/auth/` — sign-in (email+password only, no
  on-device sign-up), a Keystore-encrypted DataStore session store, and
  Credential Manager for password save/retrieve. Auth talks to the same
  better-auth REST endpoints desktop uses, via the `bearer()` plugin
  (`packages/auth/src/auth.ts`) instead of a cookie jar.
- `app/src/main/java/com/example/sync/` — every local insert/delete also
  queues a `PendingOperation` (the outbox, mirroring
  `packages/persistence/src/sync/outbox.ts`). `SyncRepository.syncOnce()`
  POSTs the outbox plus the stored cursor to `/api/sync` in a single round
  trip (push and pull happen together — there's no separate pull endpoint),
  applies pulled changes back with last-write-wins-by-`rowVersion`, and a
  `SyncWorker` (WorkManager `CoroutineWorker`) runs it periodically and right
  after each local write.
- `sync/CanonicalJson.kt` reimplements
  `packages/contracts/src/sync/canonical-json.ts`'s exact key-sorted,
  whitespace-free JSON encoding by hand, because `payloadHash` has to match
  the server's SHA-256 of that exact string or every operation gets rejected.
  `CanonicalJsonTest` checks it against a golden hash generated from the real
  TypeScript `operationPayloadHash` — regenerate that fixture the same way if
  the algorithm ever needs to change, don't just update the expected value.
- **Known gap:** the server's `categoryId` is a real per-organization foreign
  key (not a fixed enum), and there's no seeding guarantee for it. Every
  product-creating operation also upserts a `"general"` category row
  alongside the product/batch changes so the FK target exists
  (`sync/EntityRows.kt`). This app's own free-text `Product.category`
  (medicine/cosmetics/general, for local grouping) is **not** sent as
  `categoryId` — syncing Android's category taxonomy against the server's
  real categories is unsolved, not silently assumed away.

## Remote endpoints — Gemini stays direct, sync goes through our server

OCR parsing still calls the Gemini API **directly** from the client
(`generativelanguage.googleapis.com`, key injected via AI Studio secrets into
`BuildConfig.GEMINI_API_KEY`) — that was an explicit earlier decision and
still holds; don't proxy it through our server as a drive-by change.

Auth and sync, by contrast, now go through the store-electron server
(`BuildConfig.STORE_API_BASE_URL`, set via `apps/android/.env`). That value
**must** be a real deployed Worker URL (`bun run deploy:dev`/`deploy:prod`
from the repo root) — the AI Studio remote emulator can't reach a developer
machine's `localhost`.

## Design system

Colors, radius, and typography scale in `app/src/main/java/com/example/ui/theme/`
are hand-ported from `apps/desktop/src/styles.css` (Tailwind `@theme` tokens):
neutral-800/neutral-100 monochrome primary, semantic warning/success/info
colors (amber/emerald/blue), `--radius: 0.625rem` → 10dp corner radius. There
is no shared token package between the two apps yet, so keep them in sync by
hand when `styles.css` changes.

Typography uses the system default font, not Inter — Inter Variable isn't
bundled as an Android font resource. Adding it (via a `font/` resource or
`androidx.compose.ui.text.googlefonts`) is a follow-up, not done here.

## Caveat

None of this has been build-verified — there's no Android SDK/emulator in
this environment to run `./gradlew build` or Compose previews. Push to the
remote and check the AI Studio emulator to confirm it compiles.
