import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";

import { colors } from "@/theme/tokens";

export type IconProps = {
  readonly icon: IconSvgElement;
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
};

export function Icon({ icon, size = 24, color = colors.ink, strokeWidth = 1.5 }: IconProps) {
  return <HugeiconsIcon icon={icon} size={size} color={color} strokeWidth={strokeWidth} />;
}
