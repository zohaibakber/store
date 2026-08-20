/**
 * The palette, resolved. See `design-system.md` §2.
 *
 * `apps/web/src/styles.css` is the source of truth, but it is written in
 * Tailwind v4 terms — `oklch()` swatches, `color-mix()` and `--alpha()` — none
 * of which React Native can parse. So the same values live here already
 * converted to sRGB hex, with the web expression they came from noted beside
 * them. Change `styles.css` and this file changes with it, never one alone.
 */

/** Tailwind v4 swatches used by the web theme, converted from oklch to sRGB. */
const swatch = {
  amber400: "#ffb900",
  amber500: "#fe9a00",
  amber700: "#bb4d00",
  black: "#000000",
  blue400: "#51a2ff",
  blue500: "#2b7fff",
  blue700: "#1447e6",
  emerald400: "#00d492",
  emerald500: "#00bc7d",
  emerald700: "#007a55",
  neutral100: "#f5f5f5",
  neutral400: "#a1a1a1",
  neutral50: "#fafafa",
  neutral500: "#737373",
  neutral800: "#262626",
  red400: "#ff6467",
  red500: "#fb2c36",
  red700: "#c10007",
  white: "#ffffff",
} as const;

/** `--alpha(var(--color-black) / n%)` and friends, as 8-digit hex. */
const blackAlpha = { 4: "#0000000a", 8: "#00000014", 10: "#0000001a" } as const;
const whiteAlpha = { 4: "#ffffff0a", 6: "#ffffff0f", 8: "#ffffff14" } as const;

/**
 * Every token is an `#RRGGBB` or `#RRGGBBAA` string, which is the one format
 * React Native styles, SwiftUI props and Compose props all accept.
 */
export type Hex = `#${string}`;

export type ColorToken = keyof typeof light;

const light = {
  accent: blackAlpha[4],
  accentForeground: swatch.neutral800,
  background: swatch.white,
  border: blackAlpha[8],
  card: swatch.white,
  cardForeground: swatch.neutral800,
  destructive: swatch.red500,
  destructiveForeground: swatch.red700,
  foreground: swatch.neutral800,
  info: swatch.blue500,
  infoForeground: swatch.blue700,
  input: blackAlpha[10],
  muted: blackAlpha[4],
  /** `color-mix(in srgb, neutral-500 90%, black)` */
  mutedForeground: "#686868",
  onScrim: swatch.white,
  popover: swatch.white,
  popoverForeground: swatch.neutral800,
  primary: swatch.neutral800,
  primaryForeground: swatch.neutral50,
  ring: swatch.neutral400,
  scrim: "#00000099",
  secondary: blackAlpha[4],
  secondaryForeground: swatch.neutral800,
  success: swatch.emerald500,
  successForeground: swatch.emerald700,
  warning: swatch.amber500,
  warningForeground: swatch.amber700,
} as const;

const dark = {
  accent: whiteAlpha[4],
  accentForeground: swatch.neutral100,
  /** `color-mix(in srgb, neutral-950 95%, white)` */
  background: "#161616",
  border: whiteAlpha[6],
  /** `color-mix(in srgb, background 98%, white)` */
  card: "#1b1b1b",
  cardForeground: swatch.neutral100,
  /** `color-mix(in srgb, red-500 90%, white)` */
  destructive: "#fb414a",
  destructiveForeground: swatch.red400,
  foreground: swatch.neutral100,
  info: swatch.blue500,
  infoForeground: swatch.blue400,
  input: whiteAlpha[8],
  muted: whiteAlpha[4],
  /** `color-mix(in srgb, neutral-500 90%, white)` */
  mutedForeground: "#818181",
  onScrim: swatch.white,
  popover: "#1b1b1b",
  popoverForeground: swatch.neutral100,
  primary: swatch.neutral100,
  primaryForeground: swatch.neutral800,
  ring: swatch.neutral500,
  scrim: "#000000b3",
  secondary: whiteAlpha[4],
  secondaryForeground: swatch.neutral100,
  success: swatch.emerald500,
  successForeground: swatch.emerald400,
  warning: swatch.amber500,
  warningForeground: swatch.amber400,
} satisfies Record<ColorToken, Hex>;

export type ColorScheme = "light" | "dark";
export type Palette = Readonly<Record<ColorToken, Hex>>;

export const palettes = { dark, light } as const satisfies Record<ColorScheme, Palette>;

/** Tailwind's `/nn` opacity suffix. Tokens that already carry alpha pass through. */
export const alpha = (color: Hex, fraction: number): Hex => {
  if (color.length === 9) return color;
  const clamped = Math.round(Math.min(1, Math.max(0, fraction)) * 255);
  // SAFETY: `color` is `#RRGGBB` here (the 9-char case returned above) and
  // `clamped` is a byte, so `toString(16).padStart(2, "0")` is exactly two hex
  // digits — the result is a `#RRGGBBAA` string.
  return `${color}${clamped.toString(16).padStart(2, "0")}` as Hex;
};

/** `--radius: 0.625rem` and the multiplicative scale from `styles.css`. */
const radiusBase = 10;
export const radius = {
  "2xl": radiusBase * 1.8,
  "3xl": radiusBase * 2.2,
  full: 999,
  lg: radiusBase,
  md: radiusBase * 0.8,
  sm: radiusBase * 0.6,
  xl: radiusBase * 1.4,
} as const;

export const space = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
} as const;

/** Heights from `design-system.md` §4. */
export const size = {
  buttonSm: 40,
  control: 48,
  icon: 40,
  listRow: 48,
  listRowTwoLine: 64,
  productRow: 68,
  touch: 44,
} as const;

export const motion = {
  /** `cubic-bezier(0.23, 1, 0.32, 1)` */
  easeOut: [0.23, 1, 0.32, 1] as const,
  enterMs: 200,
  pressMs: 120,
  pressScale: 0.97,
  reducedOpacity: 0.72,
} as const;

export const disabledOpacity = 0.64;
