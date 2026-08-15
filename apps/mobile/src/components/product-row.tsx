import { memo } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/mobile-ui";
import { formatPrice } from "@/lib/products";

type ProductRowProps = {
  name: string;
  category: string;
  details: string;
  aisle: string | null;
  stock: number;
  stockLabel: string;
  unitPrice: number | null;
  visible: boolean;
};

export const ProductRow = memo(function ProductRow({
  name,
  category,
  details,
  aisle,
  stock,
  stockLabel,
  unitPrice,
  visible,
}: ProductRowProps) {
  const stockColor = stock === 0 ? "danger" : stock <= 10 ? "warning" : "success";
  const secondary = [details, aisle ? `Aisle ${aisle}` : null].filter(Boolean).join(" · ");

  return (
    <View
      accessibilityLabel={`${name}, ${stockLabel}, ${formatPrice(unitPrice)}`}
      className="bg-surface mb-2.5 flex-row items-center gap-3 rounded-3xl border border-border px-3 py-3"
    >
      <View className="bg-blue-soft size-11 items-center justify-center rounded-2xl">
        <Text className="text-blue text-base font-medium">
          {name.slice(0, 1).toLocaleUpperCase()}
        </Text>
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="shrink text-sm font-medium text-foreground" numberOfLines={1}>
            {name}
          </Text>
          {!visible ? (
            <Chip color="default" size="sm" variant="soft">
              Hidden
            </Chip>
          ) : null}
        </View>
        <Text className="text-xs font-normal text-muted" numberOfLines={1}>
          {category}
        </Text>
        {secondary ? (
          <Text className="text-xs font-normal text-muted" numberOfLines={1}>
            {secondary}
          </Text>
        ) : null}
      </View>
      <View className="max-w-[38%] items-end gap-2">
        <Text className="font-mono text-sm text-foreground" numberOfLines={1}>
          {formatPrice(unitPrice)}
        </Text>
        <Chip color={stockColor} size="sm" variant="soft">
          {stockLabel}
        </Chip>
      </View>
    </View>
  );
});
