import { StyleSheet, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PressableScale } from "@/components/ui/pressable-scale";

/**
 * The catalog search box: one `Input` with the magnifier in its leading slot and
 * a clear button that only exists while there is something to clear.
 */
export function ProductSearchField({
  onChangeText,
  query,
}: {
  readonly onChangeText: (query: string) => void;
  readonly query: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Input
          accessibilityLabel="Search inventory"
          autoCapitalize="none"
          leadingIcon="search"
          onChangeText={onChangeText}
          placeholder="Name, category, aisle or batch"
          returnKeyType="search"
          value={query}
        />
      </View>
      {query ? (
        <PressableScale
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          style={styles.clear}
        >
          <Icon name="close" size={18} tone="muted" />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: { alignItems: "center", height: 44, justifyContent: "center", width: 36 },
  field: { flex: 1, minWidth: 0 },
  row: { alignItems: "center", flexDirection: "row", gap: 4 },
});
