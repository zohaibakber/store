import type { MaterialColors } from "@expo/ui/jetpack-compose";

import { useTheme } from "@/theme/colors";
import { alpha, type ColorScheme, type Hex, type Palette } from "@/theme/tokens";

/**
 * Tokens mapped onto Material 3 role names.
 *
 * `useMaterialColors()` returns the device palette derived from the wallpaper
 * (Material You), so the same build tinted differently per phone while web
 * stayed neutral. Compose accepts explicit colors; Android keeps Material
 * structure and takes paint from our palette instead.
 *
 * `tertiary` is warning, `error` is destructive — Material accent roles remapped
 * to meaning, not brand hue.
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

export type ComposeTheme = {
  readonly colors: MaterialColors;
  readonly scheme: ColorScheme;
  /** `Host seedColor` so implicit tints use our neutral primary. */
  readonly seedColor: Hex;
  readonly tokens: Palette;
};

export const useComposeTheme = (): ComposeTheme => {
  const { colors, scheme } = useTheme();
  return { colors: composeColors(colors), scheme, seedColor: colors.primary, tokens: colors };
};
