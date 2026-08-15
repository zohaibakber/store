import { BottomSheet, Button as ExpoButton, Column, Host, Text as ExpoText } from "@expo/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, usePathname } from "expo-router";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";
import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";

import { useThemeColor } from "@/components/mobile-ui";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

function TabButton({
  icon,
  isFocused,
  label,
  ...props
}: ComponentProps<typeof Pressable> & {
  icon: MaterialIconName;
  isFocused?: boolean;
  label: string;
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"]);
  const color = isFocused ? accent : muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      className={`${isFocused ? "bg-accent-soft" : "active:bg-surface-tertiary"} min-h-14 min-w-16 items-center justify-center gap-0.5 rounded-2xl px-3`}
      {...props}
    >
      <MaterialIcons color={color} name={icon} size={22} />
      <Text className={isFocused ? "text-xs font-medium text-accent" : "text-xs text-muted"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FloatingTabs() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { theme } = useUniwind();
  const [actionOpen, setActionOpen] = useState(false);
  const [surface, separator, accent, accentForeground] = useThemeColor([
    "surface",
    "separator",
    "accent",
    "accent-foreground",
  ]);
  const isRootTab = pathname === "/home" || pathname === "/products" || pathname === "/settings";

  const openRoute = (href: "/products/new" | "/products/scan") => {
    setActionOpen(false);
    requestAnimationFrame(() => router.push(href));
  };

  return (
    <Tabs style={styles.tabs}>
      <View style={styles.slot}>
        <TabSlot />
      </View>

      {isRootTab ? (
        <>
          <TabList
            style={[
              styles.tabList,
              {
                backgroundColor: surface,
                borderColor: separator,
                bottom: Math.max(insets.bottom, 10),
              },
            ]}
          >
            <TabTrigger asChild href="/home" name="home" resetOnFocus>
              <TabButton icon="home" label="Home" />
            </TabTrigger>
            <TabTrigger asChild href="/products" name="products" resetOnFocus>
              <TabButton icon="inventory-2" label="Products" />
            </TabTrigger>
            <TabTrigger asChild href="/settings" name="settings" resetOnFocus>
              <TabButton icon="settings" label="Settings" />
            </TabTrigger>
          </TabList>
          <Pressable
            accessibilityLabel="Add inventory"
            accessibilityRole="button"
            className="absolute size-16 items-center justify-center rounded-full bg-accent active:opacity-75"
            onPress={() => setActionOpen(true)}
            style={[styles.action, { bottom: Math.max(insets.bottom, 10) }]}
          >
            <MaterialIcons color={accentForeground} name="add" size={30} />
          </Pressable>
        </>
      ) : null}

      <Host colorScheme={theme === "dark" ? "dark" : "light"} matchContents seedColor={accent}>
        <BottomSheet isPresented={actionOpen} onDismiss={() => setActionOpen(false)}>
          <Column spacing={12} style={styles.sheetContent}>
            <ExpoText textStyle={{ fontSize: 20, fontWeight: "600" }}>Add inventory</ExpoText>
            <ExpoText textStyle={{ color: theme === "dark" ? "#a3a3a3" : "#6b7280" }}>
              Enter the details yourself or scan a product label.
            </ExpoText>
            <ExpoButton label="Create with form" onPress={() => openRoute("/products/new")} />
            <ExpoButton
              label="Scan product"
              onPress={() => openRoute("/products/scan")}
              variant="outlined"
            />
          </Column>
        </BottomSheet>
      </Host>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  action: {
    elevation: 10,
    right: 14,
  },
  sheetContent: {
    height: 230,
    padding: 24,
  },
  slot: { flex: 1 },
  tabList: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 14,
    minHeight: 64,
    paddingHorizontal: 4,
    position: "absolute",
    right: 88,
  },
  tabs: { flex: 1 },
});
