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

## Data model

`app/src/main/java/com/example/data/` mirrors the `products` + `batches`
tables in `packages/db/src/shared/store.schema.ts` (name, category,
composition, strength, batch number, `expiresAt` as epoch millis, unit/pack
quantity). Multi-tenant and sync columns (`organizationId`, `deviceId`,
`operationId`, row versioning, etc.) are intentionally omitted — this is a
local scanning buffer, not yet wired into the sync pipeline described in
`[[inventory-app-direction]]`. When that sync work happens, this schema is
the starting point to extend, not replace.

## Remote endpoints — unchanged for now

This app calls the Gemini API **directly** from the client
(`generativelanguage.googleapis.com`, key injected via AI Studio secrets into
`BuildConfig.GEMINI_API_KEY`). That is intentional for now: do **not**
redirect parsing calls through the store-electron server yet. Proxying
through our own backend (so the API key isn't shipped in the APK) is a
separate, later migration — flag it but don't do it as a drive-by change.

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
