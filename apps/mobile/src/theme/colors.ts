import { useAppColorScheme } from "@/theme/appearance";
import { alpha, palettes, type ColorScheme, type Hex, type Palette } from "@/theme/tokens";

export type { ColorScheme, Hex, Palette };
export { alpha };

/**
 * The app's colors, for the current appearance. Semantic names only — this is
 * deliberately not `Color.ios.*` or `Color.android.dynamic.*`: the product is
 * neutral on both platforms and does not inherit a wallpaper or a system accent.
 * See `design-system.md` §2.
 */
export const useColors = (): Palette => palettes[useAppColorScheme()];

/** The palette and the appearance that chose it. */
export type Theme = {
  readonly colors: Palette;
  readonly scheme: ColorScheme;
};

/**
 * Appearance plus palette, for the `@expo/ui` hosts that need both: they take
 * `colorScheme` so the native subtree flips with the JS tree, and
 * `seedColor` so Compose/SwiftUI derive their implicit tints from our neutral
 * primary instead of Material You or iOS blue.
 */
export const useTheme = (): Theme => {
  const scheme = useAppColorScheme();
  return { colors: palettes[scheme], scheme };
};

export type StatusToken = "destructive" | "success" | "warning" | "info";

/** A tinted surface and the colour anything drawn on it should use. */
export type StatusSurface = {
  readonly backgroundColor: Hex;
  readonly borderColor: Hex;
  readonly tint: Hex;
};

/** The coss Alert surface: a 6% wash inside a 32% border. */
export const statusSurface = (colors: Palette, status: StatusToken): StatusSurface => ({
  backgroundColor: alpha(colors[status], 0.06),
  borderColor: alpha(colors[status], 0.32),
  tint: colors[status],
});

/** Text colour for a status, which is always the *-Foreground end of the pair. */
export const statusText = (colors: Palette, status: StatusToken): Hex =>
  colors[`${status}Foreground`];
