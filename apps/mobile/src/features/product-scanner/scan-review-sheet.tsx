import type { ReactNode, RefObject } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

type ScanReviewSheetProps = {
  title: string;
  subtitle: string;
  error: string | null;
  notice: string | null;
  bottomInset: number;
  scrollRef: RefObject<ScrollView | null>;
  children: ReactNode;
};

export function ScanReviewSheet({
  title,
  subtitle,
  error,
  notice,
  bottomInset,
  scrollRef,
  children,
}: ScanReviewSheetProps) {
  const colors = useColors();

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(bottomInset, 16) + 24 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.sheetScroll}
      >
        <View style={styles.intro}>
          <Text variant="subheading">{title}</Text>
          <Text tone="muted" variant="caption">
            {subtitle}
          </Text>
        </View>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert variant="success">
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingHorizontal: 16, paddingTop: 4 },
  intro: { gap: 4 },
  sheet: {
    borderCurve: "continuous",
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    bottom: 0,
    left: 0,
    maxHeight: "72%",
    position: "absolute",
    right: 0,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: radius.full,
    height: 4,
    marginBottom: 8,
    marginTop: 10,
    width: 36,
  },
  sheetScroll: { flexGrow: 0 },
});
