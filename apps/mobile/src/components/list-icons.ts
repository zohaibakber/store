import { Icon } from "@expo/ui";

import inventoryIcon from "@/assets/icons/inventory.xml";
import warningIconAsset from "@/assets/icons/warning.xml";

export const warningIcon = Icon.select({
  ios: "exclamationmark.triangle.fill",
  android: warningIconAsset,
});

export const inventoryIconName = Icon.select({
  ios: "shippingbox.fill",
  android: inventoryIcon,
});
