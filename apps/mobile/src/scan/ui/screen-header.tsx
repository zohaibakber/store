import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={styles.button}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Pressable>
      <View style={styles.titles}>
        <Text size="lg" weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {action === undefined ? null : (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text size="sm" weight="medium">
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: space[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.ground,
  },
  button: {
    width: touch.minimum,
    height: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
  },
  titles: { flex: 1, gap: 2, paddingVertical: space[2] },
  action: {
    minHeight: touch.minimum,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
});
