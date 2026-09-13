---
name: expo-ui
description: Build or migrate native component trees using @expo/ui in an Expo app.
version: 1.0.0
license: MIT
allowed-tools: "Bash(node *expo-ui/scripts/list-components.js *)"
---

# Expo UI

Check the installed Expo SDK and `@expo/ui` types before selecting a component layer. The bundled universal examples target SDK 56+; earlier SDKs need their version-specific APIs and runtime support.

Use universal components when they cover the required behavior. Platform-specific trees are appropriate for platform-specific capabilities. Preserve an existing library unless replacing it is part of the task.

- Universal trees: [universal components](references/universal.md).
- iOS trees: [SwiftUI](references/swift-ui.md).
- Android trees: [Jetpack Compose](references/jetpack-compose.md).
- Replacing an existing community library: [drop-in replacements](references/drop-in-replacements.md).

Each native tree needs the appropriate `Host`. For SDK 56 examples, import it from `@expo/ui`. Keep iOS-only and Android-only imports isolated in platform components so they are not evaluated on the other platform. Check the installed Router's platform-file rules before using platform suffixes in routes.

Use the project's existing run scripts and development client. Expo Go is suitable when the installed SDK and required native modules support it.
