# Android app

Native Compose client in `apps/android`. Expo remains in `apps/mobile`.

- JDK 17, AGP 9.2, Gradle 9.4.1, compileSdk 37, Compose BOM 2026.08.00.
- First-party JWT auth. Firebase Auth is optional and sits beside it.
- PowerSync Kotlin 1.14.1. Schema lives in `InventorySchema` and column lists in `:core`.
- Secrets: `local.properties` and `app/google-services.json`. See README.md.

```sh
./gradlew :core:test
./gradlew test
./gradlew :app:assembleDebug
```
