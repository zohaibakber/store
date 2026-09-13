---
name: expo-native-ui
description: Build Expo screens with native controls, semantic colors, safe areas, and platform visual effects.
version: 1.1.1
license: MIT
---

# Expo native UI

Adapt to the installed Expo SDK, target platforms, and existing design system. Choose references for the feature being built rather than loading a complete mobile guide.

## Layout and platform behavior

Account for top and bottom safe areas using the navigator and the chosen scroll container or inset handling. Scrollable content belongs in a ScrollView or virtualized list; fixed screens need not scroll. Put scroll-content padding in `contentContainerStyle`.

Use native text and image components outside webviews or Expo DOM components. Make copyable data selectable and use tabular numerals where counters must align. Preserve the project's styling approach and navigation conventions.

Semantic colors should adapt to the platform theme. See [colors](references/colors.md) when implementing them. Native color objects cannot be passed directly to every animation or third-party string prop.

## References by feature

- [Controls](references/controls.md): switches, sliders, pickers, and dates.
- [Icons](references/icons.md): SF Symbols and platform support.
- [Animations](references/animations.md): Reanimated, gestures, and layout transitions.
- [Visual effects](references/visual-effects.md): blur and glass.
- [Gradients](references/gradients.md): architecture-dependent gradient APIs.
- [Media](references/media.md): camera, audio, video, and saving files.
- [Storage](references/storage.md): SQLite, AsyncStorage, and SecureStore.
- [WebGPU and Three.js](references/webgpu-three.md): GPU and 3D work.

For navigation, consult installed Expo Router APIs and version-matched documentation. Use the project's development client when configured; choose Expo Go only if it supports the required native modules and SDK.
