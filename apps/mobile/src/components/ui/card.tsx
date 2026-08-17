import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

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

const styles = StyleSheet.create({
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
});
