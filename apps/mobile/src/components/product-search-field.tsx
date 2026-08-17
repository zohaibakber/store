import { Pressable, StyleSheet, View } from "react-native";

import { IconSymbol } from "@/components/symbol";
import { Input } from "@/components/ui/input";
import { useThemeColor } from "@/hooks/use-theme-color";

type ProductSearchFieldProps = {
  onChangeText: (query: string) => void;
  query: string;
  resetKey: number;
};

export function ProductSearchField({ onChangeText, query }: ProductSearchFieldProps) {
  const foreground = useThemeColor("foreground");

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Input
          accessibilityLabel="Search inventory"
          onChangeText={onChangeText}
          placeholder="Name, category, aisle or batch"
          returnKeyType="search"
          value={query}
        />
      </View>
      {query ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => onChangeText("")}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.56 : 1 }]}
        >
          <IconSymbol name="xmark" size={20} tintColor={foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 40,
  },
  field: { flex: 1, minWidth: 0 },
  row: { alignItems: "center", flexDirection: "row", gap: 4 },
});
