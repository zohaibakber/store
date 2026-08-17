import { createContext, use, type ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

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
  return <Text selectable style={[styles.alertDescription, { color: muted }, style]} {...props} />;
};

export const Alert = Object.assign(AlertRoot, {
  Content: AlertContent,
  Description: AlertDescription,
  Indicator: AlertIndicator,
  Title: AlertTitle,
});

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
});
