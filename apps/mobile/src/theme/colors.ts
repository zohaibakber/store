import { useAppColorScheme } from "@/theme/appearance";
import { alpha, palettes, type ColorScheme, type Hex, type Palette } from "@/theme/tokens";

export type { ColorScheme, Hex, Palette };
export { alpha };

/**
 * Semantic palette for the current appearance — not `Color.ios.*` or
 * `Color.android.dynamic.*`. The product stays neutral and does not inherit a
 * wallpaper or system accent.
 */
export const useColors = (): Palette => palettes[useAppColorScheme()];

export type Theme = {
  readonly colors: Palette;
  readonly scheme: ColorScheme;
};

/**
 * For `@expo/ui` hosts: `colorScheme` flips the native subtree with JS, and
 * `seedColor` steers Compose/SwiftUI implicit tints off Material You / iOS blue.
 */
export const useTheme = (): Theme => {
  const scheme = useAppColorScheme();
  return { colors: palettes[scheme], scheme };
};

export type StatusToken = "destructive" | "success" | "warning" | "info";

export type StatusSurface = {
  readonly backgroundColor: Hex;
  readonly borderColor: Hex;
  readonly tint: Hex;
};

export const statusSurface = (colors: Palette, status: StatusToken): StatusSurface => ({
  backgroundColor: alpha(colors[status], 0.06),
  borderColor: alpha(colors[status], 0.32),
  tint: colors[status],
});

export const statusText = (colors: Palette, status: StatusToken): Hex =>
  colors[`${status}Foreground`];
