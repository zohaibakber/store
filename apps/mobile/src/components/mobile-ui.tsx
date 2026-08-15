import {
  Button as ExpoButton,
  Host,
  Switch as ExpoSwitch,
  TextInput as ExpoTextInput,
  type TextInputRef,
  useNativeState,
} from "@expo/ui";
import * as Schema from "effect/Schema";
import {
  createContext,
  type ComponentProps,
  type ReactNode,
  type Ref,
  use,
  useEffect,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useUniwind } from "uniwind";

const palette = {
  light: {
    background: "#ffffff",
    foreground: "#262626",
    muted: "#737373",
    surface: "#ffffff",
    "surface-secondary": "#fafafa",
    "surface-tertiary": "#f5f5f5",
    separator: "rgba(0, 0, 0, 0.08)",
    accent: "#262626",
    "accent-foreground": "#fafafa",
    "accent-soft": "#f5f5f5",
    blue: "#525252",
    purple: "#525252",
    warning: "#c45b05",
    "warning-soft": "#ffedd5",
    danger: "#dc2626",
    "danger-soft": "#fee2e2",
    success: "#15803d",
    "success-soft": "#dcfce7",
  },
  dark: {
    background: "#111111",
    foreground: "#f5f5f5",
    muted: "#a3a3a3",
    surface: "#141414",
    "surface-secondary": "#171717",
    "surface-tertiary": "#1f1f1f",
    separator: "rgba(255, 255, 255, 0.06)",
    accent: "#f5f5f5",
    "accent-foreground": "#262626",
    "accent-soft": "#1f1f1f",
    blue: "#d4d4d4",
    purple: "#d4d4d4",
    warning: "#fbbf24",
    "warning-soft": "#422e13",
    danger: "#fb7185",
    "danger-soft": "#421c27",
    success: "#4ade80",
    "success-soft": "#143723",
  },
} as const;

type ThemeColor = keyof (typeof palette)["light"];
const isThemeColorList = (
  input: ThemeColor | ReadonlyArray<ThemeColor>,
): input is ReadonlyArray<ThemeColor> => Array.isArray(input);

export function useThemeColor(color: ThemeColor): string;
export function useThemeColor<const T extends ReadonlyArray<ThemeColor>>(
  colors: T,
): { [K in keyof T]: string };
export function useThemeColor(
  input: ThemeColor | ReadonlyArray<ThemeColor>,
): string | ReadonlyArray<string> {
  const { theme } = useUniwind();
  const colors = palette[theme === "dark" ? "dark" : "light"];
  return isThemeColorList(input) ? input.map((key) => colors[key]) : colors[input];
}

type ButtonProps = {
  children: ReactNode;
  isDisabled?: boolean;
  onPress?: () => void;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger-soft";
};

const nativeButtonVariant = {
  primary: "filled",
  secondary: "outlined",
  outline: "outlined",
  ghost: "text",
  "danger-soft": "outlined",
} as const;

export function Button({
  children,
  isDisabled,
  onPress,
  size = "md",
  style,
  testID,
  variant = "primary",
}: ButtonProps) {
  const { theme } = useUniwind();
  const label =
    Schema.is(Schema.String)(children) || Schema.is(Schema.Number)(children)
      ? String(children)
      : undefined;

  return (
    <Host
      colorScheme={theme === "dark" ? "dark" : "light"}
      matchContents={{ vertical: true }}
      seedColor={variant === "danger-soft" ? "#dc2626" : "#525252"}
      style={style}
    >
      <ExpoButton
        disabled={isDisabled}
        label={label}
        onPress={onPress}
        style={size === "sm" ? styles.nativeButtonSmall : styles.nativeButton}
        testID={testID}
        variant={nativeButtonVariant[variant]}
      >
        {label ? undefined : children}
      </ExpoButton>
    </Host>
  );
}

type CardProps = ComponentProps<typeof View> & {
  children: ReactNode;
  variant?: "default" | "secondary" | "accent" | "blue" | "purple";
};
const CardRoot = ({ children, style, variant = "default", ...props }: CardProps) => {
  const [surface, secondary, separator] = useThemeColor([
    "surface",
    "surface-secondary",
    "separator",
  ]);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: variant === "default" ? surface : secondary, borderColor: separator },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};
const CardBody = ({ style, ...props }: ComponentProps<typeof View>) => (
  <View style={[styles.cardBody, style]} {...props} />
);
const CardHeader = ({ style, ...props }: ComponentProps<typeof View>) => (
  <View style={[styles.cardHeader, style]} {...props} />
);
const CardFooter = ({ style, ...props }: ComponentProps<typeof View>) => (
  <View style={[styles.cardFooter, style]} {...props} />
);
const CardTitle = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const foreground = useThemeColor("foreground");
  return <Text style={[styles.cardTitle, { color: foreground }, style]} {...props} />;
};
const CardDescription = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const muted = useThemeColor("muted");
  return <Text style={[styles.cardDescription, { color: muted }, style]} {...props} />;
};
export const Card = Object.assign(CardRoot, {
  Body: CardBody,
  Description: CardDescription,
  Footer: CardFooter,
  Header: CardHeader,
  Title: CardTitle,
});

type ChoiceChipProps = Omit<ComponentProps<typeof Pressable>, "children"> & {
  children: ReactNode;
  selected: boolean;
};
export function ChoiceChip({ children, selected, ...props }: ChoiceChipProps) {
  const [accent, accentForeground, surface, foreground] = useThemeColor([
    "accent",
    "accent-foreground",
    "surface-tertiary",
    "foreground",
  ]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? accent : surface,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
      {...props}
    >
      <Text style={[styles.chipText, { color: selected ? accentForeground : foreground }]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const [surface, foreground, danger, dangerSoft, warning, warningSoft, success, successSoft] =
    useThemeColor([
      "surface-tertiary",
      "foreground",
      "danger",
      "danger-soft",
      "warning",
      "warning-soft",
      "success",
      "success-soft",
    ]);
  const colors = {
    default: [surface, foreground],
    danger: [dangerSoft, danger],
    success: [successSoft, success],
    warning: [warningSoft, warning],
  } as const;
  const [backgroundColor, color] = colors[tone];
  return (
    <View style={[styles.chip, { backgroundColor }]}>
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  );
}

export const TextField = ({
  isRequired: _isRequired,
  style,
  ...props
}: ComponentProps<typeof View> & { isRequired?: boolean }) => (
  <View style={[styles.field, style]} {...props} />
);
export const Label = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const foreground = useThemeColor("foreground");
  return <Text style={[styles.label, { color: foreground }, style]} {...props} />;
};
type InputProps = {
  accessibilityLabel?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoFocus?: boolean;
  editable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  numberOfLines?: number;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  ref?: Ref<TextInputRef>;
  returnKeyType?: ReturnKeyTypeOptions;
  secureTextEntry?: boolean;
  selectTextOnFocus?: boolean;
  testID?: string;
  value?: string;
};

export function Input({
  accessibilityLabel,
  autoCapitalize,
  autoFocus,
  editable,
  keyboardType,
  maxLength,
  multiline,
  numberOfLines,
  onChangeText,
  placeholder,
  ref,
  returnKeyType,
  secureTextEntry,
  selectTextOnFocus,
  testID,
  value = "",
}: InputProps) {
  const { theme } = useUniwind();
  const nativeValue = useNativeState(value);
  const colors = palette[theme === "dark" ? "dark" : "light"];

  useEffect(() => {
    if (nativeValue.value !== value) nativeValue.value = value;
  }, [nativeValue, value]);

  return (
    <Host
      accessibilityLabel={accessibilityLabel}
      accessible={Boolean(accessibilityLabel)}
      colorScheme={theme === "dark" ? "dark" : "light"}
      matchContents={{ vertical: true }}
      seedColor="#525252"
      style={multiline ? styles.inputHostMultiline : styles.inputHost}
    >
      <ExpoTextInput
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        ref={ref}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        selectTextOnFocus={selectTextOnFocus}
        selectionColor={colors.accent}
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.separator,
          borderRadius: 10,
          borderWidth: 1,
          height: multiline ? 96 : 52,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 0,
        }}
        testID={testID}
        textStyle={{
          color: colors.foreground,
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          lineHeight: 20,
        }}
        value={nativeValue}
      />
    </Host>
  );
}

type AlertTone = "danger" | "success";
const AlertToneContext = createContext<AlertTone>("danger");
const AlertRoot = ({
  children,
  style,
  status = "danger",
  ...props
}: ComponentProps<typeof View> & { status?: AlertTone }) => (
  <AlertToneContext value={status}>
    <AlertSurface status={status} style={style} {...props}>
      {children}
    </AlertSurface>
  </AlertToneContext>
);
const AlertSurface = ({
  children,
  status,
  style,
  ...props
}: ComponentProps<typeof View> & { status: AlertTone }) => {
  const [background, border] = useThemeColor([
    status === "danger" ? "danger-soft" : "success-soft",
    status === "danger" ? "danger" : "success",
  ]);
  return (
    <View
      style={[styles.alert, { backgroundColor: background, borderColor: border }, style]}
      {...props}
    >
      {children}
    </View>
  );
};
const AlertIndicator = () => {
  const tone = use(AlertToneContext);
  const color = useThemeColor(tone === "danger" ? "danger" : "success");
  return <View style={[styles.alertIndicator, { backgroundColor: color }]} />;
};
const AlertContent = ({ style, ...props }: ComponentProps<typeof View>) => (
  <View style={[styles.alertContent, style]} {...props} />
);
const AlertTitle = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const foreground = useThemeColor("foreground");
  return <Text style={[styles.alertTitle, { color: foreground }, style]} {...props} />;
};
const AlertDescription = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const muted = useThemeColor("muted");
  return <Text style={[styles.alertDescription, { color: muted }, style]} {...props} />;
};
export const Alert = Object.assign(AlertRoot, {
  Content: AlertContent,
  Description: AlertDescription,
  Indicator: AlertIndicator,
  Title: AlertTitle,
});

export const Spinner = ({
  color,
  size = "small",
}: {
  color?: string;
  size?: "sm" | "small" | "large";
}) => {
  const defaultColor = useThemeColor("foreground");
  return (
    <ActivityIndicator
      color={!color || color === "default" ? defaultColor : color}
      size={size === "sm" ? "small" : size}
    />
  );
};

export const Separator = ({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) => {
  const separator = useThemeColor("separator");
  return (
    <View
      style={[
        orientation === "vertical" ? styles.separatorVertical : styles.separator,
        { backgroundColor: separator },
      ]}
    />
  );
};

export function Switch({
  isSelected,
  onSelectedChange,
  testID,
}: {
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { theme } = useUniwind();
  return (
    <Host colorScheme={theme === "dark" ? "dark" : "light"} matchContents seedColor="#525252">
      <ExpoSwitch onValueChange={onSelectedChange} testID={testID} value={isSelected} />
    </Host>
  );
}

const styles = StyleSheet.create({
  alert: {
    alignItems: "flex-start",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  alertContent: { flex: 1, gap: 2, minWidth: 0 },
  alertDescription: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 20 },
  alertIndicator: { borderRadius: 4, height: 8, marginTop: 4, width: 8 },
  alertTitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  card: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardBody: { padding: 16 },
  cardDescription: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 20 },
  cardFooter: { flexDirection: "row", paddingBottom: 16, paddingHorizontal: 16 },
  cardHeader: { gap: 4, paddingHorizontal: 16, paddingTop: 16 },
  cardTitle: { fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 22 },
  chip: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  field: { gap: 8 },
  inputHost: {
    alignSelf: "stretch",
    height: 52,
  },
  inputHostMultiline: {
    alignSelf: "stretch",
    height: 96,
  },
  nativeButton: {
    borderRadius: 10,
    height: 48,
  },
  nativeButtonSmall: {
    borderRadius: 10,
    height: 40,
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  separator: { height: StyleSheet.hairlineWidth },
  separatorVertical: { marginHorizontal: 8, width: StyleSheet.hairlineWidth },
});
