import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { Brand } from "@/components/brand";
import { useThemeColor } from "@/hooks/use-theme-color";

const ERROR_IN = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const ERROR_OUT = FadeOut.duration(140).reduceMotion(ReduceMotion.System);

/** The one auth surface. Every step composes into it; nothing else pushes a route. */
export function AuthShell({ children }: { readonly children: ReactNode }) {
  const background = useThemeColor("background");

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: background }}
    >
      <Brand />
      {children}
    </ScrollView>
  );
}

export function StepHeader({
  caption,
  title,
}: {
  readonly caption: string;
  readonly title: string;
}) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);

  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: foreground }]}>{title}</Text>
      <Text selectable style={[styles.caption, { color: muted }]}>
        {caption}
      </Text>
    </View>
  );
}

export function ErrorLine({ message }: { readonly message: string }) {
  const danger = useThemeColor("danger");

  return (
    <Animated.View entering={ERROR_IN} exiting={ERROR_OUT}>
      <Text selectable style={[styles.error, { color: danger }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

export function Footnote({ children }: { readonly children: string }) {
  const muted = useThemeColor("muted");
  return (
    <Text selectable style={[styles.footnote, { color: muted }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  caption: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 28,
    justifyContent: "center",
    maxWidth: 420,
    padding: 24,
    width: "100%",
  },
  error: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  footnote: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  header: { gap: 6 },
  title: { fontFamily: "Inter_500Medium", fontSize: 24, lineHeight: 30 },
});
