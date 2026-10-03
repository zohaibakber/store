---
name: expo
description: Native UI in `apps/mobile` with `@expo/ui`, Jetpack Compose and React Native. Choosing a component layer, hosting native trees, text input state, lists, tokens, animation and safe areas. Use when writing or reviewing code under `apps/mobile`.
---

# Expo UI in the mobile app

`apps/mobile` is Android only, light theme only, on the Expo SDK pinned in its `package.json`, with Expo Router under `src/app` and React Compiler on. `@expo/ui` is versioned with the SDK and changes between releases, so the installed package is the authority:

```bash
ls apps/mobile/node_modules/@expo/ui/build/universal
ls apps/mobile/node_modules/@expo/ui/build/jetpack-compose
```

Each component's props are in `<Component>/index.d.ts` beside it; modifiers are in `jetpack-compose/modifiers`. Docs: `https://docs.expo.dev/versions/latest/sdk/ui/universal/<name>/index.md` and `…/sdk/ui/jetpack-compose/<name>/index.md`.

## Pick the layer

1. **A wrapper in `src/ui` or the feature's `ui` folder**, when one exists: `Text`, `Icon`, `ComposeActionButton`, the auth `Field`.
2. **Universal `@expo/ui`** (`Column`, `Row`, `Button`, `Switch`, `Checkbox`, `Slider`, `TextInput`, `Picker`, `BottomSheet`, `Collapsible`, `List`, `FieldGroup`).
3. **`@expo/ui/jetpack-compose`**, when the universal layer lacks the component or modifier. Its API mirrors Compose and Material 3, so that knowledge applies.
4. **React Native views**, for custom layout, long lists, camera surfaces and anything animated with Reanimated.

A component from a community library (bottom sheet, date picker, menu, pager, picker, segmented control, slider, masked view) comes from `@expo/ui/community/<name>`, which keeps that library's API on native components.

## Native trees

- Every native tree sits in `Host`, imported from `@expo/ui`, with `colorScheme="light"`.
- `matchContents` sizes the host to its content; `matchContents={{ vertical: true }}` with `alignSelf: "stretch"` fills the width. A host whose child scrolls or fills (`LazyColumn`) takes an explicit size: `style={{ flex: 1 }}`.
- Layout inside a Compose tree uses modifiers (`fillMaxWidth()`, `padding(...)`, `defaultMinSize(...)`), built once at module scope, as `src/ui/action-button.tsx` does.
- A React Native view inside a native tree is wrapped in `RNHostView`.
- `List` and `LazyColumn` render each item as a JSX node on the JS thread. A long or unbounded list is a `FlashList`.
- A Compose `Icon` takes an Android XML vector drawable. In React Native trees, icons are Hugeicons through `src/ui/icon.tsx`.
- A composable or modifier that `@expo/ui` does not expose can be added with a local Expo module. Ask the user first; it changes the native build.

## Text input

`TextInput` from `@expo/ui` is driven by native state, not a string:

```tsx
const text = useNativeState("");

const onChangeText = useCallback(
  (value: string) => {
    "worklet";
    text.value = value.toUpperCase();
  },
  [text],
);

<Host matchContents={{ vertical: true }} colorScheme="light">
  <TextInput value={text} onChangeText={onChangeText} />
</Host>;
```

`value` and `selection` take the `ObservableState` from `useNativeState`. The handler runs as a worklet on the UI thread, so masking and formatting happen without a React render. Read `text.value` when submitting.

## Styling

- Colours, font families, type sizes, spacing, radii, touch targets and durations come from `src/theme/tokens.ts`. The type scale is the one in `AGENTS.md`: 12, 14, 16, 18, 24, regular and medium only.
- Text is `Text` from `src/ui/text.tsx` (`size`, `weight`, `tone`, `mono`, `tabular`). Numbers that must align take `tabular`; data a user would copy takes `selectable`.
- Touch targets are at least `touch.minimum`.
- Styles are `StyleSheet.create` objects built from tokens.

## Layout

- Insets come from `useSafeAreaInsets()`. Apply them where the content meets the edge.
- Padding for scrolling content goes in `contentContainerStyle`.
- A screen that fits does not scroll.

## Animation

- Reanimated, with durations from `motion` in the tokens.
- Mount, unmount and reorder use `entering`, `exiting` and `layout` (`FadeIn.duration(motion.quick)`, `LinearTransition`).
- Animate `transform` and `opacity`. Width and height animations relayout every frame.
- Scroll-driven and gesture-driven values use `useAnimatedStyle` with `interpolate` clamped.

## Platform and build

- The app runs in its development client (`expo start --dev-client`, `expo run:android`). Expo Go cannot load its native modules.
- Adding a native dependency needs a new development build. Say so before adding one.
- If iOS is ever added: `@expo/ui/jetpack-compose` imports crash there, so Compose trees move to `.android.tsx` files outside `src/app` (Expo Router rejects platform suffixes on routes), with a `swift-ui` sibling.
- Secrets are stored through `expo-secure-store` (`src/auth/vault.ts`).

## Done when

Every `@expo/ui` component and prop in the change exists in the installed package, every native tree has a `Host`, values come from the tokens, and `vp check` passes.
