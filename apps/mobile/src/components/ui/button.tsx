import { createContext, use, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { useColors, type Palette } from "@/theme/colors";
import { radius, size as sizes, type Hex } from "@/theme/tokens";

export type ButtonVariant = "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "icon";

type ButtonSkin = {
  readonly backgroundColor: Hex | "transparent";
  readonly borderColor: Hex | "transparent";
  readonly foreground: Hex;
};

const skin = (colors: Palette, variant: ButtonVariant): ButtonSkin => {
  switch (variant) {
    case "default":
      return {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
        foreground: colors.primaryForeground,
      };
    case "destructive":
      return {
        backgroundColor: colors.destructive,
        borderColor: colors.destructive,
        // Not `background`: that is near-black in dark mode, and dark text on a
        // red fill reads as a warning chip. Web uses `text-white` in both.
        foreground: colors.onStatus,
      };
    case "outline":
      return {
        backgroundColor: colors.card,
        borderColor: colors.input,
        foreground: colors.foreground,
      };
    case "secondary":
      return {
        backgroundColor: colors.secondary,
        borderColor: "transparent",
        foreground: colors.secondaryForeground,
      };
    case "ghost":
    case "link":
      return {
        backgroundColor: "transparent",
        borderColor: "transparent",
        foreground: colors.foreground,
      };
    default: {
      const exhaustive: never = variant;
      return exhaustive;
    }
  }
};

type ButtonLabel = {
  readonly foreground: Hex;
  readonly underline: boolean;
};

const ButtonContext = createContext<ButtonLabel | null>(null);

export function Button({
  accessibilityLabel,
  children,
  isDisabled,
  loading = false,
  onPress,
  size = "default",
  style,
  testID,
  variant = "default",
}: {
  readonly accessibilityLabel?: string;
  readonly children: ReactNode;
  readonly isDisabled?: boolean;
  readonly loading?: boolean;
  readonly onPress?: () => void;
  readonly size?: ButtonSize;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly variant?: ButtonVariant;
}) {
  const colors = useColors();
  const { backgroundColor, borderColor, foreground } = skin(colors, variant);

  return (
    <ButtonContext value={{ foreground, underline: variant === "link" }}>
      <PressableScale
        accessibilityLabel={accessibilityLabel}
        isDisabled={isDisabled || loading}
        layoutStyle={style}
        onPress={onPress}
        style={[
          styles.base,
          size === "sm" && styles.sm,
          size === "icon" && styles.iconOnly,
          variant === "link" && styles.link,
          { backgroundColor, borderColor },
        ]}
        testID={testID}
      >
        <View style={[styles.row, loading && styles.hidden]}>{children}</View>
        {loading ? (
          <ActivityIndicator color={foreground} size="small" style={styles.spinner} />
        ) : null}
      </PressableScale>
    </ButtonContext>
  );
}

const useLabel = (): ButtonLabel => {
  const colors = useColors();
  return use(ButtonContext) ?? { foreground: colors.foreground, underline: false };
};

export function ButtonText({ children }: { readonly children: string }) {
  const { foreground, underline } = useLabel();
  return (
    <Text
      numberOfLines={1}
      style={[{ color: foreground }, underline && styles.underline]}
      variant="bodyMedium"
    >
      {children}
    </Text>
  );
}

export function ButtonIcon({ name }: { readonly name: IconName }) {
  const { foreground } = useLabel();
  return <Icon color={foreground} name={name} size={18} />;
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    height: sizes.control,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  hidden: { opacity: 0 },
  iconOnly: { height: sizes.icon, paddingHorizontal: 0, width: sizes.icon },
  link: { height: sizes.touch, paddingHorizontal: 4 },
  row: { alignItems: "center", flexDirection: "row", gap: 8 },
  sm: { borderRadius: radius.md, height: sizes.buttonSm, paddingHorizontal: 12 },
  spinner: { position: "absolute" },
  underline: { textDecorationLine: "underline" },
});
