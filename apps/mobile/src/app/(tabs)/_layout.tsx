import { DeliveryBox01Icon, Invoice03Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react-native";
import { Tabs } from "expo-router";

import { useSyncBadge } from "@/features/sync/sync-badge";
import { colors, fonts, type } from "@/theme/tokens";
import { Icon } from "@/ui/icon";

const tabIcon =
  (icon: IconSvgElement) =>
  ({ focused }: { readonly focused: boolean }) => (
    <Icon icon={icon} color={focused ? colors.ink : colors.muted} size={24} />
  );

const screenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.ink,
  tabBarInactiveTintColor: colors.muted,
  tabBarStyle: {
    backgroundColor: colors.ground,
    borderTopColor: colors.hairline,
    height: 80,
    paddingTop: 8,
  },
  tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: type.xs.fontSize },
  tabBarBadgeStyle: {
    backgroundColor: colors.error,
    color: colors.ground,
    fontFamily: fonts.medium,
    fontSize: type.xs.fontSize,
  },
} as const;

export default function TabsLayout() {
  const syncBadge = useSyncBadge();
  return (
    <Tabs backBehavior="initialRoute" screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{ title: "Stock", tabBarIcon: tabIcon(DeliveryBox01Icon) }}
      />
      <Tabs.Screen name="sales" options={{ title: "Sales", tabBarIcon: tabIcon(Invoice03Icon) }} />
      <Tabs.Screen
        name="sync"
        options={{ title: "Sync", tabBarIcon: tabIcon(RefreshIcon), tabBarBadge: syncBadge }}
      />
    </Tabs>
  );
}
