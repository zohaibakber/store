import {
  Alert02Icon,
  Loading03Icon,
  Tick02Icon,
  Wifi01Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from "react-native-reanimated";

import { colors, motion, radius, space, touch } from "@/theme/tokens";
import { Icon, type IconProps } from "@/ui/icon";
import { Text } from "@/ui/text";

import type { ProductScanMode } from "../model";
import type { DraftStatus } from "../status";
import { PressScale } from "../ui/press-scale";

export function CameraIconButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  readonly icon: IconProps["icon"];
  readonly label: string;
  readonly onPress: () => void;
  readonly active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.iconButton, active && styles.iconButtonActive]}
    >
      <Icon icon={icon} size={22} color={active ? colors.ink : colors.onCamera} />
    </Pressable>
  );
}

export function StatusChip({
  online,
  draftCount,
  onPress,
}: {
  readonly online: boolean;
  readonly draftCount: number;
  readonly onPress: () => void;
}) {
  const label = online ? "Online" : "Offline";
  const drafts = draftCount === 0 ? null : `${draftCount} ${draftCount === 1 ? "draft" : "drafts"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={drafts === null ? label : `${label}, ${drafts}. Open drafts`}
      onPress={onPress}
      style={styles.statusChip}
    >
      <Icon icon={online ? Wifi01Icon : WifiOff01Icon} size={16} color={colors.onCamera} />
      <Text size="xs" weight="medium" tone="onCamera">
        {drafts === null ? label : `${label} · ${drafts}`}
      </Text>
    </Pressable>
  );
}

const MODES: ReadonlyArray<{ readonly mode: ProductScanMode; readonly label: string }> = [
  { mode: "product", label: "Product" },
  { mode: "batch", label: "Batch" },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  readonly mode: ProductScanMode;
  readonly onChange: (mode: ProductScanMode) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.modeToggle}>
      {MODES.map((option) => {
        const selected = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.mode)}
            style={[styles.modeOption, selected && styles.modeOptionSelected]}
          >
            <Text
              size="sm"
              weight="medium"
              style={{ color: selected ? colors.ink : colors.onCamera }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Shutter({
  onPress,
  auto,
  busy,
}: {
  readonly onPress: () => void;
  readonly auto: boolean;
  readonly busy: boolean;
}) {
  return (
    <PressScale
      onPress={onPress}
      enabled={!busy}
      accessibilityLabel={auto ? "Capture now (auto-capture is on)" : "Capture"}
      style={styles.shutterRing}
    >
      <View style={[styles.shutterCore, auto && styles.shutterAuto, busy && styles.shutterBusy]} />
    </PressScale>
  );
}

export function CaptureChip({
  message,
  detail = null,
}: {
  readonly message: string | null;
  readonly detail?: string | null;
}) {
  if (message === null) return null;
  return (
    <Animated.View
      key={message}
      accessibilityLiveRegion="polite"
      entering={ZoomIn.duration(motion.quick)}
      exiting={FadeOut.duration(motion.quick)}
      style={styles.captureChip}
    >
      <Icon icon={Tick02Icon} size={16} color={colors.ink} />
      <View style={styles.captureText}>
        <Text size="sm" weight="medium">
          {message}
        </Text>
        {detail === null ? null : (
          <Text size="xs" numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

export function LastScanThumbnail({
  uri,
  onPress,
}: {
  readonly uri: string | null;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open saved scans"
      onPress={onPress}
      style={styles.thumbnail}
    >
      {uri === null ? null : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
    </Pressable>
  );
}

export type TrayItem = {
  readonly id: string;
  readonly photoUri: string | null;
  readonly status: DraftStatus;
};

const badgeIcon = { ready: Tick02Icon, check: Alert02Icon, reading: Loading03Icon } as const;
const badgeLabel = { ready: "parsed", check: "needs check", reading: "reading" } as const;

const TrayThumb = React.memo(function TrayThumb({
  photoUri,
  status,
}: {
  readonly photoUri: string | null;
  readonly status: DraftStatus;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.standard)}
      layout={LinearTransition.duration(motion.quick)}
      accessible
      accessibilityLabel={`Scan, ${badgeLabel[status]}`}
      style={styles.trayThumb}
    >
      {photoUri === null ? null : (
        <Image
          source={{ uri: photoUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={photoUri}
        />
      )}
      <View style={[styles.badge, status === "check" && styles.badgeCheck]}>
        <Icon
          icon={badgeIcon[status]}
          size={12}
          strokeWidth={2}
          color={status === "check" ? colors.ink : colors.onCamera}
        />
      </View>
    </Animated.View>
  );
});

const renderTrayItem = ({ item }: { readonly item: TrayItem }) => (
  <TrayThumb photoUri={item.photoUri} status={item.status} />
);

const trayKey = (item: TrayItem) => item.id;

export function Tray({ items }: { readonly items: ReadonlyArray<TrayItem> }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.tray}>
      <FlashList
        horizontal
        data={items}
        renderItem={renderTrayItem}
        keyExtractor={trayKey}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.trayContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: touch.minimum,
    height: touch.minimum,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cameraChip,
  },
  iconButtonActive: { backgroundColor: colors.highlight },
  statusChip: {
    minHeight: touch.minimum,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: colors.cameraChip,
  },
  modeToggle: {
    flexDirection: "row",
    alignSelf: "center",
    padding: space[1],
    borderRadius: radius.full,
    backgroundColor: colors.cameraChip,
  },
  modeOption: {
    minHeight: 40,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
  },
  modeOptionSelected: { backgroundColor: colors.onCamera },
  shutterRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: colors.onCamera,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterCore: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.onCamera,
  },
  shutterAuto: { backgroundColor: colors.highlight },
  shutterBusy: { opacity: 0.5 },
  captureText: { flexShrink: 1 },
  captureChip: {
    maxWidth: "90%",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: colors.highlight,
  },
  thumbnail: {
    width: touch.primary,
    height: touch.primary,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.onCamera,
    backgroundColor: colors.cameraChip,
  },
  tray: { height: 72 },
  trayContent: { paddingHorizontal: space[4] },
  trayThumb: {
    width: 56,
    height: 64,
    marginRight: space[2],
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.cameraChip,
  },
  badge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cameraScrim,
  },
  badgeCheck: { backgroundColor: colors.highlight },
});
