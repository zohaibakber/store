import { alpha, useColors, type Hex } from "@/theme/colors";

/**
 * @deprecated Use `useColors()` from `@/theme/colors` and the semantic token
 * names in `design-system.md` §2.
 *
 * This maps the old iOS/Material-flavoured names (`accent`, `separator`,
 * `surface-tertiary`, `danger-soft`…) onto the shared palette so screens that
 * have not been converted yet still compile — and, more importantly, still
 * render the right colors. `accent` in particular used to resolve to
 * `systemBlue` / Material You `primary`; it is now the neutral `primary`.
 */
const legacyTokens = (colors: ReturnType<typeof useColors>) =>
  ({
    accent: colors.primary,
    "accent-foreground": colors.primaryForeground,
    "accent-soft": colors.secondary,
    background: colors.background,
    blue: colors.info,
    danger: colors.destructive,
    "danger-soft": alpha(colors.destructive, 0.1),
    foreground: colors.foreground,
    muted: colors.mutedForeground,
    purple: colors.info,
    separator: colors.border,
    success: colors.success,
    "success-soft": alpha(colors.success, 0.12),
    surface: colors.card,
    "surface-secondary": colors.secondary,
    "surface-tertiary": colors.secondary,
    warning: colors.warning,
    "warning-soft": alpha(colors.warning, 0.12),
  }) as const;

type LegacyToken = keyof ReturnType<typeof legacyTokens>;

const isTokenList = (
  input: LegacyToken | ReadonlyArray<LegacyToken>,
): input is ReadonlyArray<LegacyToken> => Array.isArray(input);

export function useThemeColor(color: LegacyToken): Hex;
export function useThemeColor<const T extends ReadonlyArray<LegacyToken>>(
  colors: T,
): { [K in keyof T]: Hex };
export function useThemeColor(
  input: LegacyToken | ReadonlyArray<LegacyToken>,
): Hex | ReadonlyArray<Hex> {
  const tokens = legacyTokens(useColors());
  return isTokenList(input) ? input.map((key) => tokens[key]) : tokens[input];
}
