import { createContext, forwardRef, type ComponentProps, type ReactNode, use } from "react";
import {
  ActivityIndicator,
  Pressable,
  Switch as NativeSwitch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useUniwind } from "uniwind";

const join = (...values: ReadonlyArray<string | undefined | false>) =>
  values.filter(Boolean).join(" ");

const palette = {
  light: {
    background: "#f2f6fa",
    foreground: "#10233d",
    muted: "#65758b",
    surface: "#ffffff",
    "surface-secondary": "#eaf0f6",
    "surface-tertiary": "#dfe7f0",
    separator: "rgba(16, 35, 61, 0.08)",
    accent: "#0f766e",
    "accent-foreground": "#ffffff",
    "accent-soft": "#ccfbf1",
    blue: "#2563eb",
    purple: "#7c3aed",
    warning: "#c45b05",
    danger: "#dc2626",
    success: "#15803d",
  },
  dark: {
    background: "#07121f",
    foreground: "#edf6ff",
    muted: "#8fa3b8",
    surface: "#0e1d2c",
    "surface-secondary": "#142638",
    "surface-tertiary": "#1b3045",
    separator: "rgba(225, 239, 255, 0.07)",
    accent: "#2dd4bf",
    "accent-foreground": "#052e2b",
    "accent-soft": "#123c3b",
    blue: "#60a5fa",
    purple: "#c4b5fd",
    warning: "#fbbf24",
    danger: "#fb7185",
    success: "#4ade80",
  },
} as const;

type ThemeColor = keyof (typeof palette)["light"];

export function useThemeColor(color: ThemeColor): string;
export function useThemeColor<const T extends ReadonlyArray<ThemeColor>>(
  colors: T,
): { [K in keyof T]: string };
export function useThemeColor(
  input: ThemeColor | ReadonlyArray<ThemeColor>,
): string | ReadonlyArray<string> {
  const { theme } = useUniwind();
  const colors = palette[theme === "dark" ? "dark" : "light"];
  return typeof input === "string" ? colors[input] : input.map((key) => colors[key]);
}

type ButtonProps = ComponentProps<typeof Pressable> & {
  children: ReactNode;
  className?: string;
  isDisabled?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger-soft";
};

const buttonClasses = {
  primary: "bg-accent",
  secondary: "bg-surface-tertiary",
  outline: "border border-border bg-transparent",
  ghost: "bg-transparent",
  "danger-soft": "bg-danger/12",
};

const buttonTextClasses = {
  primary: "text-accent-foreground",
  secondary: "text-foreground",
  outline: "text-foreground",
  ghost: "text-foreground",
  "danger-soft": "text-danger",
};

export function Button({
  children,
  className,
  isDisabled,
  size = "md",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className={join(
        "items-center justify-center rounded-2xl active:opacity-70",
        size === "sm" ? "min-h-10 px-3" : "min-h-12 px-4",
        buttonClasses[variant],
        isDisabled && "opacity-45",
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {typeof children === "string" ? (
        <Text className={join("text-sm font-medium", buttonTextClasses[variant])}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

type CardProps = ComponentProps<typeof View> & {
  children: ReactNode;
  variant?: "default" | "secondary" | "accent" | "blue" | "purple";
};
const CardRoot = ({ children, className, variant = "default", ...props }: CardProps) => (
  <View
    className={join(
      "overflow-hidden rounded-3xl border border-border",
      variant === "secondary"
        ? "bg-surface-secondary"
        : variant === "accent"
          ? "border-accent-border bg-accent-soft"
          : variant === "blue"
            ? "border-blue/15 bg-blue-soft"
            : variant === "purple"
              ? "border-purple/15 bg-purple-soft"
              : "bg-surface",
      className,
    )}
    {...props}
  >
    {children}
  </View>
);
const CardBody = ({ className, ...props }: ComponentProps<typeof View>) => (
  <View className={join("p-4", className)} {...props} />
);
const CardHeader = ({ className, ...props }: ComponentProps<typeof View>) => (
  <View className={join("gap-1 px-4 pt-4", className)} {...props} />
);
const CardFooter = ({ className, ...props }: ComponentProps<typeof View>) => (
  <View className={join("flex-row px-4 pb-4", className)} {...props} />
);
const CardTitle = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("text-base font-medium text-foreground", className)} {...props} />
);
const CardDescription = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("text-xs leading-5 text-muted", className)} {...props} />
);
export const Card = Object.assign(CardRoot, {
  Body: CardBody,
  Description: CardDescription,
  Footer: CardFooter,
  Header: CardHeader,
  Title: CardTitle,
});

type ChipProps = ComponentProps<typeof Pressable> & {
  children: ReactNode;
  color?: "default" | "accent" | "danger" | "warning" | "success";
  size?: "sm";
  variant?: "soft";
};
export function Chip({ children, className, color = "default", ...props }: ChipProps) {
  const colors = {
    accent: "bg-accent text-accent-foreground",
    danger: "bg-danger-soft text-danger",
    default: "bg-surface-tertiary text-foreground",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
  };
  const [backgroundClass, textClass] = colors[color].split(" ");
  return (
    <Pressable
      className={join(
        "min-h-8 justify-center rounded-full px-3 active:opacity-70",
        backgroundClass,
        className,
      )}
      {...props}
    >
      <Text className={join("text-xs font-medium", textClass)}>{children}</Text>
    </Pressable>
  );
}

export const TextField = ({
  className,
  isRequired: _isRequired,
  ...props
}: ComponentProps<typeof View> & { isRequired?: boolean }) => (
  <View className={join("gap-2", className)} {...props} />
);
export const Label = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("px-0.5 text-xs font-medium text-foreground", className)} {...props} />
);
export const Input = forwardRef<TextInput, ComponentProps<typeof TextInput>>(function Input(
  { className, multiline, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      className={join(
        "min-h-13 rounded-2xl border border-field-border bg-field-background px-4 text-sm text-field-foreground focus:border-accent",
        multiline && "min-h-24 py-3 text-top",
        className,
      )}
      multiline={multiline}
      placeholderTextColor="#737373"
      {...props}
    />
  );
});

type AlertTone = "danger" | "success";
const AlertToneContext = createContext<AlertTone>("danger");
const AlertRoot = ({
  children,
  className,
  status = "danger",
  ...props
}: ComponentProps<typeof View> & { status?: AlertTone }) => (
  <AlertToneContext value={status}>
    <View
      className={join(
        "flex-row items-start gap-3 rounded-2xl px-4 py-3",
        status === "danger"
          ? "border border-danger/15 bg-danger-soft"
          : "border border-success/15 bg-success-soft",
        className,
      )}
      {...props}
    >
      {children}
    </View>
  </AlertToneContext>
);
const AlertIndicator = () => {
  const tone = use(AlertToneContext);
  return (
    <View
      className={`mt-1 size-2 rounded-full ${tone === "danger" ? "bg-danger" : "bg-success"}`}
    />
  );
};
const AlertContent = ({ className, ...props }: ComponentProps<typeof View>) => (
  <View className={join("min-w-0 flex-1 gap-0.5", className)} {...props} />
);
const AlertTitle = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("text-sm font-medium text-foreground", className)} {...props} />
);
const AlertDescription = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("text-xs leading-5 text-muted", className)} {...props} />
);
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
}) => (
  <View className={orientation === "vertical" ? "bg-separator mx-2 w-px" : "bg-separator h-px"} />
);

export function Switch({
  isSelected,
  onSelectedChange,
  ...props
}: Omit<ComponentProps<typeof NativeSwitch>, "value" | "onValueChange"> & {
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  return <NativeSwitch onValueChange={onSelectedChange} value={isSelected} {...props} />;
}

const LinkButtonLabel = ({ className, ...props }: ComponentProps<typeof Text>) => (
  <Text className={join("text-sm font-medium text-foreground", className)} {...props} />
);
export const LinkButton = Object.assign(Button, { Label: LinkButtonLabel });
