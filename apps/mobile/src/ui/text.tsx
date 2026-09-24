import { Text as NativeText, type TextProps as NativeTextProps } from "react-native";

import { colors, fonts, type, type TypeSize } from "@/theme/tokens";

export type TextProps = NativeTextProps & {
  readonly size?: TypeSize;
  readonly weight?: "regular" | "medium";
  readonly tone?: "ink" | "muted" | "error" | "synced" | "onCamera";
  readonly mono?: boolean;
  readonly tabular?: boolean;
};

const toneColor = {
  ink: colors.ink,
  muted: colors.muted,
  error: colors.error,
  synced: colors.synced,
  onCamera: colors.onCamera,
} as const;

export function Text({
  size = "sm",
  weight = "regular",
  tone = "ink",
  mono = false,
  tabular = false,
  style,
  ...rest
}: TextProps) {
  return (
    <NativeText
      {...rest}
      style={[
        type[size],
        {
          color: toneColor[tone],
          fontFamily: mono ? fonts.mono : weight === "medium" ? fonts.medium : fonts.regular,
          fontVariant: tabular ? ["tabular-nums"] : undefined,
        },
        style,
      ]}
    />
  );
}
