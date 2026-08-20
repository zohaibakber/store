import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { Button, ButtonText } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import {
  extractTextFromImage,
  isTextRecognitionSupported,
} from "@/features/product-scanner/text-extractor";
import type { ProductScanMode } from "@/features/product-scanner/types";
import { hapticError, hapticSelection, hapticSuccess, hapticWarning } from "@/lib/haptics";
import { useColors } from "@/theme/colors";
import { alpha, radius } from "@/theme/tokens";
import { typography } from "@/theme/typography";

type InlineTextCameraProps = {
  readonly mode: ProductScanMode;
  readonly status: "ready" | "paused" | "syncing" | "analyzing";
  readonly resetKey: number;
  readonly onError: (message: string) => void;
  readonly onCaptureStateChange: (capturing: boolean) => void;
  readonly onTextDetected: (recognizedText: string) => Promise<void>;
};

type CaptureState = "ready" | "reading" | "found";

const promptFor = (mode: ProductScanMode) =>
  mode === "product"
    ? "Fit the product name and composition inside the frame"
    : "Fit the batch number and expiry date inside the frame";

/**
 * The viewfinder. Chrome that sits over live video is the one place the palette
 * does not apply — text has to stay legible against whatever the lens sees — so
 * it uses the `scrim` and `onScrim` tokens, which exist for exactly this.
 */
export function InlineTextCamera({
  mode,
  status,
  resetKey,
  onError,
  onCaptureStateChange,
  onTextDetected,
}: InlineTextCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState>("ready");
  const [lineCount, setLineCount] = useState(0);
  const camera = useRef<CameraView>(null);
  const colors = useColors();

  useEffect(() => {
    setCaptureState("ready");
    setLineCount(0);
  }, [mode, resetKey]);

  useEffect(() => {
    if (status !== "paused") return;
    setReady(false);
    setTorch(false);
  }, [status]);

  const capture = async () => {
    if (!ready || status !== "ready" || captureState === "reading" || !camera.current) return;
    if (!isTextRecognitionSupported) {
      onError("Text recognition is not available on this device.");
      return;
    }

    onCaptureStateChange(true);
    setCaptureState("reading");
    setLineCount(0);
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
      const lines = (await extractTextFromImage(labelImage.uri))
        .map((line) => line.trim())
        .filter(Boolean);
      const recognizedText = lines.join("\n").trim();

      if (recognizedText.length < 3) {
        setCaptureState("ready");
        hapticWarning();
        onError("No readable text yet. Move closer, reduce glare, and try again.");
        return;
      }

      setLineCount(lines.length);
      setCaptureState("found");
      hapticSuccess();
      await onTextDetected(recognizedText);
    } catch (cause) {
      setCaptureState("ready");
      hapticError();
      onError(cause instanceof Error ? cause.message : "The label could not be read.");
    } finally {
      onCaptureStateChange(false);
    }
  };

  const placeholder = { backgroundColor: colors.secondary };

  if (status === "paused") {
    return (
      <View style={[styles.placeholder, placeholder]}>
        <Text variant="bodyMedium">Camera paused</Text>
        <Text style={styles.centered} tone="muted" variant="caption">
          Return to this screen to continue scanning.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.placeholder, placeholder]}>
        <Spinner tone="muted" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.placeholder, placeholder]}>
        <Text variant="bodyMedium">Camera access is needed</Text>
        <Text style={styles.centered} tone="muted" variant="caption">
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
          ? "Reading on this phone…"
          : found
            ? "Text detected"
            : mode === "product"
              ? "Ready for the product label"
              : "Ready for batch details";
  const detail =
    status === "syncing"
      ? "Scanning unlocks once products are ready"
      : found
        ? `${lineCount} ${lineCount === 1 ? "line" : "lines"} found`
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
        ratio="4:3"
        style={StyleSheet.absoluteFill}
      />

      <View
        pointerEvents="none"
        style={[styles.guide, { borderColor: found ? colors.success : alpha(colors.onScrim, 0.8) }]}
      />

      <View style={styles.topControls}>
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
          style={[styles.torch, { backgroundColor: torch ? colors.onScrim : colors.scrim }]}
        >
          <Icon color={torch ? colors.foreground : colors.onScrim} name="bolt" size={18} />
        </PressableScale>
      </View>

      <View style={styles.captureRow}>
        <PressableScale
          accessibilityHint={`Reads ${mode === "product" ? "the product name" : "the batch and expiry"} from the camera`}
          accessibilityLabel={busy ? "Reading the label" : "Read the label"}
          isDisabled={!ready || status !== "ready" || busy}
          onPress={() => void capture()}
          style={[styles.shutter, { borderColor: colors.onScrim }]}
        >
          <View style={[styles.shutterCore, { backgroundColor: colors.onScrim }]} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  captureRow: { alignItems: "center", bottom: 18, left: 0, position: "absolute", right: 0 },
  centered: { textAlign: "center" },
  guide: {
    borderCurve: "continuous",
    borderRadius: radius["2xl"],
    borderWidth: 2,
    bottom: 92,
    left: 28,
    position: "absolute",
    right: 28,
    top: 92,
  },
  overlayCaption: typography.caption,
  overlayLabel: typography.label,
  permissionAction: { paddingTop: 8 },
  placeholder: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius["2xl"],
    gap: 6,
    height: 360,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  shell: {
    backgroundColor: "#000000",
    borderCurve: "continuous",
    borderRadius: radius["2xl"],
    height: 360,
    overflow: "hidden",
  },
  shutter: {
    alignItems: "center",
    borderRadius: radius.full,
    borderWidth: 3,
    height: 66,
    justifyContent: "center",
    width: 66,
  },
  shutterCore: { borderRadius: radius.full, height: 50, width: 50 },
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
    top: 14,
  },
  torch: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.xl,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
});
