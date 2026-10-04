---
name: expo
description: Native UI in Expo apps with `@expo/ui`, Jetpack Compose and React Native. Choosing a component layer, hosting native trees, text input state, lists, tokens, animation and safe areas. Use when writing or reviewing screens or components in an app that depends on `@expo/ui`.
---

# Expo UI

`@expo/ui` is versioned with the Expo SDK and changes between releases, so the installed package is the authority. From the app's directory:

```bash
ls node_modules/@expo/ui/build/universal
ls node_modules/@expo/ui/build/jetpack-compose
```

Each component's props are in `<Component>/index.d.ts` beside it; modifiers are in `jetpack-compose/modifiers`. Docs: `https://docs.expo.dev/versions/latest/sdk/ui/universal/<name>/index.md` and `…/sdk/ui/jetpack-compose/<name>/index.md`.

The app decides what this skill cannot: its platforms and colour scheme, its wrapper components, its tokens and its icon set. A repo records those in a profile that `AGENTS.md` or `CLAUDE.md` names. Read it first; where it differs from this skill, it wins. With no profile, read the app config for `platforms` and `userInterfaceStyle`, and find the app's `ui` folder and tokens file before using a raw primitive.

## Pick the layer

1. **The app's own wrapper**, when one exists: its `Text`, its `Icon`, its buttons and fields.
2. **Universal `@expo/ui`** (`Column`, `Row`, `Button`, `Switch`, `Checkbox`, `Slider`, `TextInput`, `Picker`, `BottomSheet`, `Collapsible`, `List`, `FieldGroup`).
3. **`@expo/ui/jetpack-compose`**, when the universal layer lacks the component or modifier. Its API mirrors Compose and Material 3, so that knowledge applies.
4. **React Native views**, for custom layout, long lists, camera surfaces and anything animated with Reanimated.

A component from a community library (bottom sheet, date picker, menu, pager, picker, segmented control, slider, masked view) comes from `@expo/ui/community/<name>`, which keeps that library's API on native components.

## Native trees

- Every native tree sits in `Host`, imported from `@expo/ui`. An app pinned to one colour scheme passes it on every host: `colorScheme="light"`.
- `matchContents` sizes the host to its content; `matchContents={{ vertical: true }}` with `alignSelf: "stretch"` fills the width. A host whose child scrolls or fills (`LazyColumn`) takes an explicit size: `style={{ flex: 1 }}`.
- Layout inside a Compose tree uses modifiers (`fillMaxWidth()`, `padding(...)`, `defaultMinSize(...)`), built once at module scope.
- A React Native view inside a native tree is wrapped in `RNHostView`.
- `List` and `LazyColumn` render each item as a JSX node on the JS thread. A long or unbounded list is a virtualized React Native list such as `FlashList`.
- A Compose `Icon` takes an Android XML vector drawable. In React Native trees, icons go through the app's icon wrapper.
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

<Host matchContents={{ vertical: true }}>
  <TextInput value={text} onChangeText={onChangeText} />
</Host>;
```

`value` and `selection` take the `ObservableState` from `useNativeState`. The handler runs as a worklet on the UI thread, so masking and formatting happen without a React render. Read `text.value` when submitting.

## Styling

- Colours, font families, type sizes, spacing, radii, touch targets and durations come from the app's tokens.
- Text is the app's `Text` wrapper. Numbers that must align take tabular figures; data a user would copy is selectable.
- Touch targets are at least the tokens' minimum.
- Styles are `StyleSheet.create` objects built from tokens.

## Layout

- Insets come from `useSafeAreaInsets()`. Apply them where the content meets the edge.
- Padding for scrolling content goes in `contentContainerStyle`.
- A screen that fits does not scroll.

## Animation

- Reanimated, with durations from the tokens.
- Mount, unmount and reorder use `entering`, `exiting` and `layout` (`FadeIn.duration(motion.quick)`, `LinearTransition`).
- Animate `transform` and `opacity`. Width and height animations relayout every frame.
- Scroll-driven and gesture-driven values use `useAnimatedStyle` with `interpolate` clamped.

## Platform and build

- An app with native modules runs in its development client (`expo start --dev-client`, `expo run:android`). Expo Go cannot load them.
- Adding a native dependency needs a new development build. Say so before adding one.
- `@expo/ui/jetpack-compose` imports crash on iOS and `@expo/ui/swift-ui` imports crash on Android. An app that ships both keeps each platform tree in an `.android.tsx` or `.ios.tsx` file outside the router directory, because Expo Router rejects platform suffixes on routes.
- Secrets are stored through `expo-secure-store`.

## Done when

Every `@expo/ui` component and prop in the change exists in the installed package, every native tree has a `Host`, values come from the tokens, and the project's check passes.
