# apps/android

Native Android (Kotlin + Jetpack Compose) app, originally generated in Google
AI Studio, now developed directly in this monorepo. It scans product/medicine
labels on-device (ML Kit OCR) and uses the Gemini API to parse the raw text
into structured fields, storing them in a local SQLCipher-encrypted Room
database.

This used to also live in a separate GitHub repo
(`zohaibakber/android-app`, imported here via `git subtree`) so AI Studio's
remote emulator could preview it. That repo and the subtree relationship are
gone — this directory is just regular committed files in this repo's history
now, no special push/pull step. Build and test locally instead (see
Verification below).

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

## Remote endpoints — Gemini stays cloud-only, sync goes through our server

OCR still runs on-device (ML Kit, `ml/TextRecognitionService.kt`, no network
call). Parsing the extracted text into structured fields now goes through the
**Firebase AI Logic SDK** (`ml/GeminiParsingService.kt`) instead of the
original hand-rolled Retrofit client — same cloud Gemini model, official
current SDK.

**Why not on-device Gemini Nano (checked, not assumed):** Firebase's own
hybrid-inference docs for Android state that structured JSON output
(`responseSchema`) is not supported on the on-device path yet, and explicitly
recommend `ONLY_IN_CLOUD` for anything that needs it. Since this app's entire
parsing job _is_ structured extraction (name/composition/batch/expiry/etc.),
on-device Gemini Nano cannot do this job today regardless of device — this
isn't a "Pixel doesn't need it" situation, it's "the on-device path doesn't
support this feature yet." Revisit if/when Google adds schema support
on-device.

**Firebase project: wired up.** App registered as `com.tabaaq.storescanner` in
the `tabaaq-67ffc` Firebase project (`firebase apps:create android` +
`firebase init ailogic`, which also enables the Gemini Developer API for that
app — the one step that genuinely needed a real account, not just CLI/API
calls). `app/google-services.json` and `.firebaserc`/`firebase.json` are
committed — the API key inside `google-services.json` is a client identifier
restricted by package name, not a bearer secret, so unlike `.env` this one is
meant to ship in source control (standard Firebase practice).
`applicationId` in `app/build.gradle.kts` was renamed from the AI Studio
placeholder (`com.aistudio.medicinescanner.xyzab`) to `com.tabaaq.storescanner`
to match — this is effectively permanent once published, so it was worth
fixing before registering rather than after.

The `com.google.firebase.ai.*` import paths (`Firebase.ai(...)`,
`GenerativeBackend` under `.type`, `Schema`, `generationConfig { }`,
`content { }`) are now build-verified against the real `firebase-ai` 17.13.0
jar (via `javap`, not just doc fetches — those partially disagreed with each
other before a real build caught two of them: `GenerativeBackend`'s actual
package and `Configuration.Provider`'s `val` vs. function override shape).

Auth and sync go through the store-electron server
(`BuildConfig.STORE_API_BASE_URL`, set via `apps/android/.env`). For local
device testing over USB, point it at `http://localhost:8787` and run
`adb reverse tcp:8787 tcp:8787` plus `bun run --cwd apps/server dev` — for a
real release build it needs an actual deployed Worker URL instead
(`bun run deploy:dev`/`deploy:prod` from the repo root).

## Design system

`ui/theme/Theme.kt` uses **Material You dynamic color**
(`dynamicLightColorScheme`/`dynamicDarkColorScheme`, API 31+) derived from the
device wallpaper, not a hand-matched brand palette — every ColorScheme role
comes out properly contrasted by construction this way. Below API 31 it falls
back to a neutral palette hand-ported from `apps/desktop/src/styles.css`
(Tailwind `@theme` tokens). Semantic warning/success/info colors
(amber/emerald/blue, `LocalSemanticColors`) stay fixed regardless of dynamic
color — those are universal meanings, not brand identity. Radius scale
(`--radius: 0.625rem` → 10dp) also stays fixed via `AppShapes`.

Because the scheme is dynamic, **always pick a color role that's actually
paired with the container you're drawing on** (e.g. text on a
`colorScheme.secondary` background must be `onSecondary`, never
`onSurfaceVariant`) — mismatched pairs render fine against the old fixed
palette but can go low-contrast or invisible under an arbitrary wallpaper
scheme. This exact bug hit the bottom-nav selected label and two other spots
(`AccountScreen`'s sync description, `ProductApp`'s detected-text chip)
before being caught by eye on a real device — there's no lint rule for it, so
re-check any new `Card`/`background` + `Text` pairing by hand.

Typography uses the system default font, not Inter — Inter Variable isn't
bundled as an Android font resource. Adding it (via a `font/` resource or
`androidx.compose.ui.text.googlefonts`) is a follow-up, not done here.

**Logo:** ported by hand from `apps/desktop/public/logo.svg` (a rounded-square
mark, not a photo, so it translates directly to vector drawables — no image
asset pipeline needed). Three drawables carry it:
`res/drawable/ic_app_background.xml` + `ic_app_foreground.xml` (the adaptive
launcher icon, referenced by `mipmap-anydpi-v26/ic_launcher*.xml`, scaled/
centered into the 108dp safe zone) and `res/drawable/ic_logo_mark.xml` (the
full badge at its native proportions, used in-app next to the title on the
sign-in screen and the main scanner's top bar). Colors come from
`res/values/colors.xml` + `res/values-night/colors.xml`
(`ic_launcher_surface`/`glyph`/`detail`) so the mark flips light/dark the same
way the SVG's `prefers-color-scheme` rule does on desktop.
Pre-API-26 `mipmap-*dpi/ic_launcher*.webp` fallback bitmaps were **not**
regenerated (still the AI Studio default robot icon) — minSdk is 24, so this
only affects Android 7.0–7.1 devices, a vanishingly small and shrinking slice
in 2026. Low-priority follow-up, not blocking.

**Camera:** rescanning UX changed from a full-screen camera takeover to a
floating window (`ui/ProductApp.kt`'s `CameraWindow` — a `Dialog` with
`usePlatformDefaultWidth = false` sizing its own rounded `Card`) over the
still-visible, dimmed product list, with its own header/close button and a
capture button inside the card rather than overlaid on the feed. The
processing overlay also now shows which stage it's in
(`ProcessingStage.DETECTING_TEXT` / `PARSING_WITH_GEMINI` in
`ui/ProductViewModel.kt`) and a preview of the on-device OCR text once it's
available, instead of one static "Analyzing..." label for the whole pipeline.

## Local development

There's no committed Gradle wrapper in this directory (dropped somewhere in
the AI Studio export) and no bundled Android SDK — both are installed
system-wide on this machine instead:

- JDK 21, Gradle (system package, not a wrapper), and the Android SDK
  (platform 36.1 + build-tools) — installed via `pacman`/`sdkmanager` into
  `~/Android/Sdk`. `local.properties` (gitignored) points `sdk.dir` there.
- `debug.keystore` (gitignored, matches the hardcoded `androiddebugkey`/
  `android` credentials in `app/build.gradle.kts`'s `debugConfig`) — generate
  once with `keytool -genkey -v -keystore debug.keystore -storepass android
-alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity
10000 -dname "CN=Android Debug,O=Android,C=US"` from this directory.

Build + install on a USB-connected device:

```sh
cd apps/android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For a device to reach the store-electron server locally: run
`bun run --cwd apps/server dev` from the repo root, `adb reverse tcp:8787
tcp:8787`, and set `STORE_API_BASE_URL=http://localhost:8787` in
`apps/android/.env` (gitignored).
