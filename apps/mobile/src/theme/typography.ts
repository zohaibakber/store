import type { TextStyle } from "react-native";

/**
 * The whole type system: Inter at 400/500, five sizes, plus Geist Mono for
 * anything that has to line up in a column. See `design-system.md` §3.
 *
 * Fonts are embedded at build time by the `expo-font` config plugin, so there
 * is no loading state to guard against.
 */
const family = {
  monoMedium: "GeistMono_500Medium",
  monoRegular: "GeistMono_400Regular",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
} as const;

export const typography = {
  body: { fontFamily: family.regular, fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: family.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: family.regular, fontSize: 12, lineHeight: 16 },
  heading: { fontFamily: family.medium, fontSize: 18, lineHeight: 26 },
  label: { fontFamily: family.medium, fontSize: 12, lineHeight: 16 },
  mono: {
    fontFamily: family.monoRegular,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  monoMedium: {
    fontFamily: family.monoMedium,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  subheading: { fontFamily: family.medium, fontSize: 16, lineHeight: 24 },
  title: { fontFamily: family.medium, fontSize: 24, lineHeight: 30 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typography;
