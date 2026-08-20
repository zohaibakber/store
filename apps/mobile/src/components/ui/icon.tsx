import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useColors } from "@/theme/colors";
import type { Hex } from "@/theme/tokens";

/**
 * A stroke icon set on a 24 grid at 1.5 weight, drawn once so iOS and Android
 * are identical and match the Hugeicons weight the web app uses. Platform
 * symbols stay where the platform owns the chrome — tab bars, FABs — and this
 * covers every surface React Native draws itself.
 */
const paths = {
  alert: ["M12 3.6 21 19.6H3z", "M12 9.4v4.1"],
  bolt: ["M13.2 3 6.2 13.6h4.4L10 21l7.4-10.9h-4.3z"],
  box: ["M12 3.2l7.8 4.4v8.8L12 20.8l-7.8-4.4V7.6z", "M4.2 7.6 12 12l7.8-4.4", "M12 12v8.8"],
  camera: ["M9 7.2l1.2-2.4h3.6L15 7.2", "M5.5 7.2h13a2.5 2.5 0 0 1 2.5 2.5v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V9.7a2.5 2.5 0 0 1 2.5-2.5z"],
  check: ["M5 12.8l4.4 4.4L19 7"],
  chevron: ["M9.6 5.8 15.6 12l-6 6.2"],
  close: ["M6.2 6.2 17.8 17.8", "M17.8 6.2 6.2 17.8"],
  info: ["M12 11.2v5.6"],
  logout: ["M14.5 4.8H7.2A2.2 2.2 0 0 0 5 7v10a2.2 2.2 0 0 0 2.2 2.2h7.3", "M11 12h8.5", "M16.6 8.8 19.8 12l-3.2 3.2"],
  person: ["M5.2 20c0-3.7 3.1-5.7 6.8-5.7s6.8 2 6.8 5.7"],
  plus: ["M12 5.2v13.6", "M5.2 12h13.6"],
  refresh: [
    "M4.2 12a7.8 7.8 0 0 1 13.3-5.5",
    "M19.8 12a7.8 7.8 0 0 1-13.3 5.5",
    "M17.6 3.4v3.3h-3.3",
    "M6.4 20.6v-3.3h3.3",
  ],
  search: ["M20.8 20.8 16.4 16.4"],
  tag: ["M20.4 13.1 13.1 20.4a2 2 0 0 1-2.8 0L3.6 13.7V3.6h10.1l6.7 6.7a2 2 0 0 1 0 2.8z"],
} as const;

const circles = {
  alert: [{ cx: 12, cy: 16.6, r: 0.9, filled: true }],
  info: [
    { cx: 12, cy: 12, r: 8.6, filled: false },
    { cx: 12, cy: 8.2, r: 0.9, filled: true },
  ],
  person: [{ cx: 12, cy: 8, r: 3.4, filled: false }],
  search: [{ cx: 10.8, cy: 10.8, r: 6.6, filled: false }],
  tag: [{ cx: 8, cy: 8, r: 1.4, filled: true }],
} as const satisfies Partial<Record<IconName, ReadonlyArray<IconDot>>>;

type IconDot = {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly filled: boolean;
};

export type IconName = keyof typeof paths;
type IconTone = "default" | "muted" | "destructive" | "success" | "warning" | "info" | "inverse";

export function Icon({
  name,
  size = 20,
  tone = "default",
  color,
  style,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly tone?: IconTone;
  readonly color?: Hex;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const stroke =
    color ??
    {
      default: colors.foreground,
      destructive: colors.destructive,
      info: colors.info,
      inverse: colors.primaryForeground,
      muted: colors.mutedForeground,
      success: colors.success,
      warning: colors.warning,
    }[tone];
  const dots: ReadonlyArray<IconDot> = name in circles ? circles[name as keyof typeof circles] : [];

  return (
    <Svg fill="none" height={size} style={style} viewBox="0 0 24 24" width={size}>
      {paths[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
      ))}
      {dots.map((dot) => (
        <Circle
          key={`${dot.cx}-${dot.cy}-${dot.r}`}
          cx={dot.cx}
          cy={dot.cy}
          fill={dot.filled ? stroke : "none"}
          r={dot.r}
          stroke={dot.filled ? undefined : stroke}
          strokeWidth={dot.filled ? undefined : 1.5}
        />
      ))}
    </Svg>
  );
}
