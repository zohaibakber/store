import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { Brand } from "@/components/brand";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { motion } from "@/theme/tokens";

const ERROR_IN = FadeIn.duration(motion.enterMs - 20).reduceMotion(ReduceMotion.System);
const ERROR_OUT = FadeOut.duration(motion.pressMs + 20).reduceMotion(ReduceMotion.System);

export function AuthShell({ children }: { readonly children: ReactNode }) {
  const colors = useColors();

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
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
  return (
    <View style={styles.header}>
      <Text variant="title">{title}</Text>
      <Text selectable tone="muted" variant="body">
        {caption}
      </Text>
    </View>
  );
}

export function ErrorLine({ message }: { readonly message: string }) {
  return (
    <Animated.View entering={ERROR_IN} exiting={ERROR_OUT}>
      <Text selectable tone="destructive" variant="body">
        {message}
      </Text>
    </Animated.View>
  );
}

export function Footnote({ children }: { readonly children: string }) {
  return (
    <Text selectable tone="muted" variant="caption">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 28,
    justifyContent: "center",
    maxWidth: 420,
    padding: 24,
    width: "100%",
  },
  header: { gap: 6 },
});
