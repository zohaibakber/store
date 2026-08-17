import type { ColorValue } from "react-native";

import { useAppColorScheme } from "@/theme/appearance";
import { colors } from "@/theme/colors";

const themeTokens = {
  background: colors.systemBackground,
  foreground: colors.label,
  muted: colors.secondaryLabel,
  surface: colors.secondarySystemBackground,
  "surface-secondary": colors.tertiarySystemBackground,
  "surface-tertiary": colors.systemFill,
  separator: colors.separator,
  accent: colors.systemBlue,
  "accent-foreground": colors.onAccent,
  "accent-soft": colors.systemFill,
  blue: colors.systemBlue,
  purple: colors.systemPurple,
  warning: colors.systemOrange,
  "warning-soft": colors.warningSoft,
  danger: colors.systemRed,
  "danger-soft": colors.dangerSoft,
  success: colors.systemGreen,
  "success-soft": colors.successSoft,
} as const;

type ThemeColor = keyof typeof themeTokens;
const isThemeColorList = (
  input: ThemeColor | ReadonlyArray<ThemeColor>,
): input is ReadonlyArray<ThemeColor> => Array.isArray(input);

export function useThemeColor(color: ThemeColor): ColorValue;
export function useThemeColor<const T extends ReadonlyArray<ThemeColor>>(
  colors: T,
): { [K in keyof T]: ColorValue };
export function useThemeColor(
  input: ThemeColor | ReadonlyArray<ThemeColor>,
): ColorValue | ReadonlyArray<ColorValue> {
  useAppColorScheme();
  return isThemeColorList(input) ? input.map((key) => themeTokens[key]) : themeTokens[input];
}
