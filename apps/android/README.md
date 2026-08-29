# Tabaaq Android

Native Kotlin + Jetpack Compose Material 3 client. This is the start of the
migration off Expo (`apps/mobile`). Expo stays in the repo.

The first slice covers sign-in, a Home / Products / Settings shell, and a live
product list from the PowerSync Kotlin SDK. Scan, invoices, catalog edits, and
Gemini label inference are still Expo-only.

## How this sits next to Expo

| Concern | Expo (`apps/mobile`) | This app |
| --- | --- | --- |
| UI | React Native + `@expo/ui` | Compose Material 3 |
| Auth | First-party JWT (`@store/auth`) + Google ID token | Same HTTP routes in Kotlin |
| Firebase | Gemini product scan only. Not user auth. | Optional Firebase Auth beside the JWT session, once `google-services.json` is present |
| Sync | `@powersync/react-native` | `com.powersync:core` 1.14.1 |
| Schema | `@store/client-db` | Mirrored in `InventorySchema` |
| Upload | `/api/inventory/mutations` | Same path for catalog tables. Invoice upload is not in this slice. |

The auth Worker still trusts `com.tabaaq.mobile://`. This app sends
`expo-origin: com.tabaaq.mobile://app` so existing deployments accept it.
`applicationId` is `com.tabaaq.android` so it can sit next to the Expo APK.

## Open in Android Studio

1. Install Android Studio (Narwhal Feature Drop or later). AGP 9.2 needs that.
2. File → Open → `apps/android`.
3. Use JDK 17 (the project toolchain is 17; this VM also has JDK 21).
4. Copy `local.properties.example` to `local.properties` and set `sdk.dir`.
5. Sync Gradle. Run the `app` configuration.

Required SDK:

- compileSdk 37
- targetSdk 36
- minSdk 26
- Android Gradle Plugin 9.2.0
- Gradle 9.3.1 (wrapper)
- Kotlin 2.2.20
- Compose BOM 2026.08.00

## Secrets

Do not commit `local.properties` or `app/google-services.json`.

```
AUTH_URL=http://10.0.2.2:8788
API_URL=http://10.0.2.2:8787
GOOGLE_WEB_CLIENT_ID=123-abc.apps.googleusercontent.com
POWERSYNC_URL=          # optional fallback; the API usually returns this
```

The emulator reaches the host through `10.0.2.2`. A physical device needs the
LAN IP of the machine running `vp run dev:web` (API `:8787`, auth `:8788`).

PowerSync tokens come from `GET /api/powersync/credentials` with the same
Bearer token Expo uses. `POWERSYNC_URL` is only a fallback when that response
omits `endpoint`.

### Firebase

Expo already talks to Firebase project `tabaaq-67ffc` for AI. User sessions do
not. Register an Android app with package `com.tabaaq.android` in that project,
download `google-services.json`, and place it at `app/google-services.json`.
`google-services.json.example` is a shape-only file with placeholders.

Without that file the Google Services plugin is skipped. Custom auth still
works. Firebase Auth signs in only after a successful Google ID token exchange,
and never replaces the first-party session.

Add this APK's SHA-1 to the Android OAuth client, the same as Expo.

## Tests

From `apps/android`:

```sh
./gradlew :core:test
./gradlew test
./gradlew :app:assembleDebug
```

`:core:test` is JVM-only (catalog mapping, stock filters, replica names, auth
validation). It does not need the Android SDK. `:app:test` and `assembleDebug`
do.

## Remaining Expo work

- Product create / edit / hide
- Batch quantity edits
- Camera scan + Firebase AI label parse
- Invoices and sales
- Organization settings and invitations
- Native Google SHA / Play signing for production
- Auth Worker allowlist for `com.tabaaq.android://`
