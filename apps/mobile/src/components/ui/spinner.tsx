import { ActivityIndicator } from "react-native";

import { useColors } from "@/theme/colors";
import type { Hex } from "@/theme/tokens";

/** The platform indicator, tinted from the palette. There is no branded loader. */
export function Spinner({
  size = "small",
  tone = "default",
  color,
}: {
  readonly size?: "small" | "large";
  readonly tone?: "default" | "muted" | "inverse";
  readonly color?: Hex;
}) {
  const colors = useColors();
  const tint =
    color ??
    {
      default: colors.foreground,
      inverse: colors.primaryForeground,
      muted: colors.mutedForeground,
    }[tone];
  return <ActivityIndicator color={tint} size={size} />;
}
