# Expo profile: Store mobile

The local facts the [expo skill](../.agents/skills/expo/SKILL.md) asks a repo for. Where the two differ, this file wins. Paths are relative to `apps/mobile`.

- **Platform.** Android only (`platforms: ["android"]` in `app.config.ts`). There are no `.ios.tsx` files and no `swift-ui` trees.
- **Theme.** Light only. Every `Host` takes `colorScheme="light"`.
- **Stack.** The Expo SDK pinned in `package.json`, Expo Router under `src/app`, React Compiler on.
- **Wrappers.** `Text` in `src/ui/text.tsx` (`size`, `weight`, `tone`, `mono`, `tabular`, and React Native's own props such as `selectable`), `Icon` in `src/ui/icon.tsx`, `ComposeActionButton` in `src/ui/action-button.tsx`, the auth `Field` in `src/auth/ui/field.tsx`. `action-button.tsx` is the example of Compose modifiers built once at module scope.
- **Tokens.** `src/theme/tokens.ts` holds colours, font families, type sizes, spacing, radii, `touch.minimum` and the `motion` durations. The type scale is the one in `AGENTS.md`: 12, 14, 16, 18, 24, regular and medium only.
- **Icons.** Hugeicons, through `src/ui/icon.tsx`, in React Native trees.
- **Lists.** A long or unbounded list is a `FlashList`.
- **Secrets.** `src/auth/vault.ts` wraps `expo-secure-store`.
- **Build.** The app runs in its development client (`expo start --dev-client`, `expo run:android`).
- **Check.** `vp check` from the repo root.
