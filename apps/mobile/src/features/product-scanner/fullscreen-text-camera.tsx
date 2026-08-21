import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ButtonText } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import type { ProductScanMode } from "@/features/product-scanner/types";
import { hapticError, hapticSelection, hapticSuccess, hapticWarning } from "@/lib/haptics";
import { useColors } from "@/theme/colors";
import { alpha, radius } from "@/theme/tokens";
import { typography } from "@/theme/typography";

type FullscreenTextCameraProps = {
  readonly mode: ProductScanMode;
  readonly status: "ready" | "paused" | "syncing" | "analyzing";
  readonly resetKey: number;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onCaptureStateChange: (capturing: boolean) => void;
  readonly onImageCaptured: (imageUri: string) => Promise<void>;
};

type CaptureState = "ready" | "reading" | "found";

const promptFor = (mode: ProductScanMode) =>
  mode === "product"
    ? "Fit the product name and composition inside the frame"
    : "Fit the batch number and expiry date inside the frame";

/**
 * Edge-to-edge viewfinder. Overlay chrome uses `scrim` / `onScrim` so labels
 * stay readable against whatever the lens sees.
 */
export function FullscreenTextCamera({
  mode,
  status,
  resetKey,
  onClose,
  onError,
  onCaptureStateChange,
  onImageCaptured,
}: FullscreenTextCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState>("ready");
  const camera = useRef<CameraView>(null);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setCaptureState("ready");
  }, [mode, resetKey]);

  useEffect(() => {
    if (status !== "paused") return;
    setReady(false);
    setTorch(false);
  }, [status]);

  const capture = async () => {
    if (!ready || status !== "ready" || captureState === "reading" || !camera.current) return;

    onCaptureStateChange(true);
    setCaptureState("reading");
    hapticSelection();
    try {
      const picture = await camera.current.takePictureAsync({
        quality: 0.84,
        shutterSound: false,
      });
      const cropWidth = Math.max(1, Math.round(picture.width * 0.84));
      const cropHeight = Math.max(1, Math.round(picture.height * 0.4));
      const manipulation = ImageManipulator.manipulate(picture.uri);
      manipulation
        .crop({
          originX: Math.round((picture.width - cropWidth) / 2),
          originY: Math.round((picture.height - cropHeight) / 2),
          width: cropWidth,
          height: cropHeight,
        })
        .resize({ width: 1600, height: null });
      const renderedImage = await manipulation.renderAsync();
      const labelImage = await renderedImage.saveAsync({
        compress: 0.9,
        format: SaveFormat.JPEG,
      });

      setCaptureState("found");
      hapticSuccess();
      await onImageCaptured(labelImage.uri);
    } catch (cause) {
      setCaptureState("ready");
      hapticError();
      onError(cause instanceof Error ? cause.message : "The label could not be read.");
    } finally {
      onCaptureStateChange(false);
    }
  };

  const placeholder = { backgroundColor: colors.viewfinder, flex: 1 };

  if (status === "paused") {
    return (
      <View style={[styles.placeholder, placeholder, { paddingTop: insets.top }]}>
        <Text style={{ color: colors.onScrim }} variant="bodyMedium">
          Camera paused
        </Text>
        <Text style={[styles.centered, { color: alpha(colors.onScrim, 0.76) }]} variant="caption">
          Return to this screen to continue scanning.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.placeholder, placeholder]}>
        <Spinner color={colors.onScrim} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.placeholder, placeholder, { paddingTop: insets.top + 24 }]}>
        <Text style={{ color: colors.onScrim }} variant="bodyMedium">
          Camera access is needed
        </Text>
        <Text style={[styles.centered, { color: alpha(colors.onScrim, 0.76) }]} variant="caption">
          The camera is used only while you scan a product label.
        </Text>
        <View style={styles.permissionAction}>
          <Button
            onPress={() =>
              permission.canAskAgain ? void requestPermission() : void Linking.openSettings()
            }
            size="sm"
            variant="outline"
          >
            <ButtonText>{permission.canAskAgain ? "Allow camera" : "Open settings"}</ButtonText>
          </Button>
        </View>
        <PressableScale
          accessibilityLabel="Close scanner"
          onPress={onClose}
          style={[styles.close, { backgroundColor: colors.scrim, top: insets.top + 12 }]}
        >
          <Icon color={colors.onScrim} name="close" size={20} />
        </PressableScale>
      </View>
    );
  }

  const busy = captureState === "reading" || status === "analyzing";
  const found = captureState === "found";
  const title =
    status === "syncing"
      ? "Syncing inventory…"
      : status === "analyzing"
        ? "Reading the label…"
        : captureState === "reading"
          ? "Capturing…"
          : found
            ? "Label captured"
            : mode === "product"
              ? "Ready for the product label"
              : "Ready for batch details";
  const detail =
    status === "syncing"
      ? "Scanning unlocks once products are ready"
      : status === "analyzing"
        ? "Extracting fields with AI"
        : found
          ? "Hold steady"
          : promptFor(mode);

  return (
    <View style={styles.shell}>
      <CameraView
        ref={camera}
        active
        animateShutter={false}
        enableTorch={torch}
        facing="back"
        mode="picture"
        onCameraReady={() => setReady(true)}
        onMountError={({ message }) => onError(message)}
        style={StyleSheet.absoluteFill}
      />

      <View
        pointerEvents="none"
        style={[
          styles.guide,
          {
            borderColor: found ? colors.success : alpha(colors.onScrim, 0.85),
            bottom: insets.bottom + 120,
            top: insets.top + 100,
          },
        ]}
      />

      <View style={[styles.topControls, { paddingTop: insets.top + 10 }]}>
        <PressableScale
          accessibilityLabel="Close scanner"
          onPress={onClose}
          style={[styles.iconButton, { backgroundColor: colors.scrim }]}
        >
          <Icon color={colors.onScrim} name="close" size={20} />
        </PressableScale>

        <View
          accessibilityLiveRegion="polite"
          accessible
          style={[
            styles.status,
            { backgroundColor: found ? alpha(colors.success, 0.9) : colors.scrim },
          ]}
        >
          {busy ? (
            <Spinner color={colors.onScrim} />
          ) : (
            <Icon
              color={colors.onScrim}
              name={found ? "check" : "camera"}
              size={16}
              style={styles.statusIcon}
            />
          )}
          <View style={styles.statusCopy}>
            <Text numberOfLines={1} style={[styles.overlayLabel, { color: colors.onScrim }]}>
              {title}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.overlayCaption, { color: alpha(colors.onScrim, 0.76) }]}
            >
              {detail}
            </Text>
          </View>
        </View>

        <PressableScale
          accessibilityLabel={torch ? "Turn the torch off" : "Turn the torch on"}
          accessibilityState={{ selected: torch }}
          isDisabled={status !== "ready" || busy}
          onPress={() => setTorch((current) => !current)}
          style={[
            styles.iconButton,
            { backgroundColor: torch ? colors.onScrim : colors.scrim },
          ]}
        >
          <Icon color={torch ? colors.foreground : colors.onScrim} name="bolt" size={18} />
        </PressableScale>
      </View>

      <View style={[styles.captureRow, { bottom: Math.max(insets.bottom, 12) + 16 }]}>
        <PressableScale
          accessibilityHint={`Reads ${mode === "product" ? "the product name" : "the batch and expiry"} from the camera`}
          accessibilityLabel={busy ? "Reading the label" : "Read the label"}
          isDisabled={!ready || status !== "ready" || busy}
          onPress={() => {
            if (busy) {
              hapticWarning();
              return;
            }
            void capture();
          }}
          style={[styles.shutter, { borderColor: colors.onScrim }]}
        >
          <View
            style={[
              styles.shutterCore,
              { backgroundColor: busy ? alpha(colors.onScrim, 0.45) : colors.onScrim },
            ]}
          />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  captureRow: { alignItems: "center", left: 0, position: "absolute", right: 0 },
  centered: { paddingHorizontal: 32, textAlign: "center" },
  close: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.xl,
    height: 40,
    justifyContent: "center",
    left: 16,
    position: "absolute",
    width: 40,
  },
  guide: {
    borderCurve: "continuous",
    borderRadius: radius["2xl"],
    borderWidth: 2,
    left: 28,
    position: "absolute",
    right: 28,
  },
  iconButton: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.xl,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  overlayCaption: typography.caption,
  overlayLabel: typography.label,
  permissionAction: { paddingTop: 12 },
  placeholder: {
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  shell: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000000",
  },
  shutter: {
    alignItems: "center",
    borderRadius: radius.full,
    borderWidth: 3,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  shutterCore: { borderRadius: radius.full, height: 56, width: 56 },
  status: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.xl,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusCopy: { flex: 1, gap: 1, minWidth: 0 },
  statusIcon: { marginVertical: 2 },
  topControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    left: 14,
    position: "absolute",
    right: 14,
  },
});
