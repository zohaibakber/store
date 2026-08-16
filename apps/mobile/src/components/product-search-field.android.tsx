import { DockedSearchBar, Host, Icon, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";
import { useUniwind } from "uniwind";

type ProductSearchFieldProps = {
  onChangeText: (query: string) => void;
  query: string;
  resetKey: number;
};

export function ProductSearchField({ onChangeText, resetKey }: ProductSearchFieldProps) {
  const { theme } = useUniwind();

  return (
    <Host
      key={resetKey}
      colorScheme={theme === "dark" ? "dark" : "light"}
      matchContents={{ vertical: true }}
      seedColor="#525252"
      style={styles.host}
    >
      <DockedSearchBar modifiers={[fillMaxWidth()]} onQueryChange={onChangeText}>
        <DockedSearchBar.LeadingIcon>
          <Icon
            contentDescription="Search inventory"
            size={22}
            source={require("../assets/icons/search.xml")}
          />
        </DockedSearchBar.LeadingIcon>
        <DockedSearchBar.Placeholder>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14 }}>Search inventory</Text>
        </DockedSearchBar.Placeholder>
      </DockedSearchBar>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { alignSelf: "stretch" },
});
