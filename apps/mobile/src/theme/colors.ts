import { Color } from "expo-router";
import { Platform, type ColorValue } from "react-native";

export const colors = {
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: "#000000",
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#3c3c43",
  })!,
  tertiaryLabel: Platform.select({
    ios: Color.ios.tertiaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#8e8e93",
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: "#c6c6c8",
  })!,
  systemBackground: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: "#ffffff",
  })!,
  secondarySystemBackground: Platform.select({
    ios: Color.ios.secondarySystemBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: "#f2f2f7",
  })!,
  tertiarySystemBackground: Platform.select({
    ios: Color.ios.tertiarySystemBackground,
    android: Color.android.dynamic.surfaceContainerLow,
    default: "#ffffff",
  })!,
  systemGroupedBackground: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.background,
    default: "#f2f2f7",
  })!,
  secondarySystemGroupedBackground: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: "#ffffff",
  })!,
  systemFill: Platform.select({
    ios: Color.ios.systemGray6,
    android: Color.android.dynamic.surfaceContainerHighest,
    default: "#e5e5ea",
  })!,
  systemBlue: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: "#007aff",
  })!,
  systemPurple: Platform.select({
    ios: Color.ios.systemPurple,
    android: Color.android.dynamic.tertiary,
    default: "#af52de",
  })!,
  systemOrange: Platform.select({
    ios: Color.ios.systemOrange,
    android: Color.android.dynamic.tertiary,
    default: "#ff9500",
  })!,
  systemRed: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: "#ff3b30",
  })!,
  systemGreen: Platform.select({
    ios: Color.ios.systemGreen,
    android: Color.android.holo_green_dark,
    default: "#34c759",
  })!,
  onAccent: Platform.select({
    ios: Color.ios.lightText,
    android: Color.android.dynamic.onPrimary,
    default: "#ffffff",
  })!,
  warningSoft: Platform.select({
    ios: Color.ios.tertiarySystemFill,
    android: Color.android.dynamic.tertiaryContainer,
    default: "#ffedd5",
  })!,
  dangerSoft: Platform.select({
    ios: Color.ios.secondarySystemFill,
    android: Color.android.dynamic.errorContainer,
    default: "#fee2e2",
  })!,
  successSoft: Platform.select({
    ios: Color.ios.tertiarySystemFill,
    android: Color.android.dynamic.primaryContainer,
    default: "#dcfce7",
  })!,
} as const satisfies Record<string, ColorValue>;

export const cssColor = (value: ColorValue): string => {
  // SAFETY: expo-router Color values are PlatformColor objects that RN accepts;
  // @expo/ui textStyle.color is typed as CSS string only.
  return value as string;
};

