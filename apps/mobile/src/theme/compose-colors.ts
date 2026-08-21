import type { MaterialColors } from "@expo/ui/jetpack-compose";

import { useTheme } from "@/theme/colors";
import { alpha, type ColorScheme, type Hex, type Palette } from "@/theme/tokens";

/**
 * Our tokens, wearing Material 3's role names.
 *
 * `useMaterialColors()` returns the *device* palette: Material You derives it
 * from the user's wallpaper, so the same build looked lilac on one phone and
 * olive on the next while the web app stayed neutral. Compose components accept
 * explicit colors, so Android keeps Material structure — list items, chips,
 * floating toolbars, pull-to-refresh — and takes its paint from
 * `design-system.md` §2 instead.
 *
 * Roles that Material treats as accent hues carry meaning here: `tertiary` is
 * warning, `error` is destructive. Nothing maps to a decorative brand color,
 * because there isn't one.
 */
export const composeColors = (colors: Palette): MaterialColors => ({
  background: colors.background,
  error: colors.destructive,
  errorContainer: alpha(colors.destructive, 0.1),
  inverseOnSurface: colors.background,
  inversePrimary: colors.primaryForeground,
  inverseSurface: colors.foreground,
  onBackground: colors.foreground,
  onError: colors.background,
  onErrorContainer: colors.destructiveForeground,
  onPrimary: colors.primaryForeground,
  onPrimaryContainer: colors.foreground,
  onPrimaryFixed: colors.foreground,
  onPrimaryFixedVariant: colors.mutedForeground,
  onSecondary: colors.primaryForeground,
  onSecondaryContainer: colors.foreground,
  onSecondaryFixed: colors.foreground,
  onSecondaryFixedVariant: colors.mutedForeground,
  onSurface: colors.foreground,
  onSurfaceVariant: colors.mutedForeground,
  onTertiary: colors.background,
  onTertiaryContainer: colors.warningForeground,
  onTertiaryFixed: colors.warningForeground,
  onTertiaryFixedVariant: colors.warningForeground,
  outline: colors.input,
  outlineVariant: colors.border,
  primary: colors.primary,
  primaryContainer: colors.secondary,
  primaryFixed: colors.secondary,
  primaryFixedDim: colors.secondary,
  scrim: colors.scrim,
  secondary: colors.primary,
  secondaryContainer: colors.secondary,
  secondaryFixed: colors.secondary,
  secondaryFixedDim: colors.secondary,
  surface: colors.background,
  surfaceBright: colors.card,
  surfaceContainer: colors.background,
  surfaceContainerHigh: colors.secondary,
  surfaceContainerHighest: colors.secondary,
  surfaceContainerLow: colors.card,
  surfaceContainerLowest: colors.card,
  surfaceDim: colors.background,
  surfaceTint: colors.primary,
  surfaceVariant: colors.secondary,
  tertiary: colors.warning,
  tertiaryContainer: alpha(colors.warning, 0.12),
  tertiaryFixed: alpha(colors.warning, 0.12),
  tertiaryFixedDim: alpha(colors.warning, 0.12),
});

/** What a Compose `Host` needs to stop deriving its own colors. */
export type ComposeTheme = {
  /** Every Material 3 role, repainted from our palette. */
  readonly colors: MaterialColors;
  readonly scheme: ColorScheme;
  /** `Host seedColor`, so implicit tints come from our neutral primary. */
  readonly seedColor: Hex;
  /** The palette itself, for props that take a color directly. */
  readonly tokens: Palette;
};

export const useComposeTheme = (): ComposeTheme => {
  const { colors, scheme } = useTheme();
  return { colors: composeColors(colors), scheme, seedColor: colors.primary, tokens: colors };
};
