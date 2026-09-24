import { Host } from "@expo/ui";
import { FilterChip, Row, Text } from "@expo/ui/jetpack-compose";
import { horizontalScroll, padding } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";

import { colors, fonts, space, type } from "@/theme/tokens";

import { stockFilters, type StockFilter } from "./stock-state";

const chipColors = {
  containerColor: colors.ground,
  labelColor: colors.ink,
  selectedContainerColor: colors.ink,
  selectedLabelColor: colors.ground,
};
const chipBorder = { width: 1, color: colors.hairline };
const labelStyle = {
  fontFamily: fonts.medium,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};
const rowModifiers = [horizontalScroll(), padding(space[4], 0, space[4], 0)];

export function FilterChips({
  value,
  onChange,
}: {
  readonly value: StockFilter;
  readonly onChange: (filter: StockFilter) => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <Row horizontalArrangement={{ spacedBy: space[2] }} modifiers={rowModifiers}>
        {stockFilters.map((filter) => (
          <FilterChip
            key={filter.id}
            border={chipBorder}
            colors={chipColors}
            onClick={() => onChange(filter.id)}
            selected={filter.id === value}
          >
            <FilterChip.Label>
              <Text style={labelStyle}>{filter.label}</Text>
            </FilterChip.Label>
          </FilterChip>
        ))}
      </Row>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: "stretch",
  },
});
