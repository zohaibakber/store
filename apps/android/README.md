# Tabaaq Android

Native Kotlin + Jetpack Compose Material 3 client. Application id is
`com.tabaaq.mobile`. Auth origin is `com.tabaaq.mobile://app`, which the Worker
already trusts.

Home, product list, create, detail, batch edits, and label scan are in this
app. Scan uses Firebase AI Logic (Gemini 2.5 Flash). Invoices and org admin
stay out of this client.

| Concern  | This app                                          |
| -------- | ------------------------------------------------- |
| UI       | Compose Material 3                                |
| Auth     | First-party JWT (`@store/auth`) + Google ID token |
| Firebase | Gemini product scan only. Not user auth.          |
| Sync     | Local SQLite replica and durable outbox           |
| Upload   | `/api/inventory/mutations` for catalog tables     |

`applicationId` is `com.tabaaq.mobile` so this build can take over the existing
Play listing.

## Open in Android Studio

1. Install Android Studio (Narwhal Feature Drop or later). AGP 9.3 needs that.
2. File → Open → `apps/android`.
3. Use JDK 21 (`:app` and `:core` both use `jvmToolchain(21)`).
4. Copy `local.properties.example` to `local.properties` and set `sdk.dir`.
5. Sync Gradle. Run the `app` configuration.

Required SDK:

- compileSdk 37 (sdkmanager package `platforms;android-37.0`)
- targetSdk 36
- minSdk 26
- Android Gradle Plugin 9.3.2 (built-in Kotlin; do not apply `kotlin-android`)
- Gradle 9.5.0 (wrapper; AGP 9.3 minimum/default)
- Kotlin 2.4.10
- Compose BOM 2026.08.00
- JDK 21 for `:app` and `:core`. Gradle itself can run on JDK 17+.

## Secrets

Do not commit `local.properties` or `app/google-services.json`.

```
AUTH_URL=http://10.0.2.2:8788
API_URL=http://10.0.2.2:8787
GOOGLE_WEB_CLIENT_ID=123-abc.apps.googleusercontent.com
```

The emulator reaches the host through `10.0.2.2`. A physical device needs the
LAN IP of the machine running `vp run dev:web` (API `:8787`, auth `:8788`).

Inventory uses a local SQLite replica and a durable outbox. Batched uploads and
cursor pulls use the authenticated inventory API. A one-use ticket connects
`/api/inventory/live` for change notifications; reconnects resume from the saved cursor.

### Firebase

Register an Android app with package `com.tabaaq.mobile` in Firebase project
`tabaaq-67ffc`, download `google-services.json`, and place it at
`app/google-services.json`. `google-services.json.example` is a shape-only file
with placeholders.

Without that file the Google Services plugin is skipped. Custom auth still
works. Firebase Auth signs in only after a successful Google ID token exchange,
and never replaces the first-party session.

Add this APK's SHA-1 to the Android OAuth client.

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

## Remaining work

- Invoices and sales
- Organization settings and invitations
- Native Google SHA / Play signing for production
- App Check on Firebase AI before production quota
- Product hide / edit of catalog fields after create
