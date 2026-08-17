import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  extractTextFromImage,
  isTextRecognitionSupported,
} from "@/features/product-scanner/text-extractor";
import type { ProductScanMode } from "@/features/product-scanner/types";
import { useThemeColor } from "@/hooks/use-theme-color";
import { hapticError, hapticSelection, hapticSuccess, hapticWarning } from "@/lib/haptics";

type InlineTextCameraProps = {
  mode: ProductScanMode;
  status: "ready" | "paused" | "syncing" | "analyzing";
  resetKey: number;
  onError: (message: string) => void;
  onCaptureStateChange: (capturing: boolean) => void;
  onTextDetected: (recognizedText: string) => Promise<void>;
};

type CaptureState = "ready" | "reading" | "found";

const promptFor = (mode: ProductScanMode) =>
  mode === "product"
    ? "Fit the product name and composition inside the frame"
    : "Fit the batch number and expiry date inside the frame";

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
  const [surface, foreground, muted] = useThemeColor(["surface-secondary", "foreground", "muted"]);

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

  if (status === "paused") {
    return (
      <View style={[styles.fallback, { backgroundColor: surface }]}>
        <Text style={[styles.fallbackTitle, { color: foreground }]}>Camera paused</Text>
        <Text style={[styles.fallbackText, { color: muted }]}>
          Return to this screen to continue scanning.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.fallback, { backgroundColor: surface }]}>
        <Spinner color="default" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.permission, { backgroundColor: surface }]}>
        <View style={styles.permissionCopy}>
          <Text style={[styles.permissionTitle, { color: foreground }]}>
            Camera access is needed
          </Text>
          <Text style={[styles.permissionText, { color: muted }]}>
            Tabaaq uses the camera only while you scan product-label text.
          </Text>
        </View>
        {permission.canAskAgain ? (
          <Button onPress={() => void requestPermission()}>Allow camera</Button>
        ) : (
          <Button onPress={() => void Linking.openSettings()}>Open settings</Button>
        )}
      </View>
    );
  }

  const busy = captureState === "reading" || status === "analyzing";
  const found = captureState === "found";
  const feedbackTitle =
    status === "syncing"
      ? "Syncing inventory…"
      : status === "analyzing"
        ? "Structuring product details…"
        : captureState === "reading"
          ? "Reading label on-device…"
          : found
            ? "Text detected"
            : mode === "product"
              ? "Ready for product label"
              : "Ready for batch details";
  const feedbackDetail =
    status === "syncing"
      ? "Scanning unlocks when current products are ready"
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

      <View pointerEvents="none" style={styles.scrim} />
      <View pointerEvents="none" style={[styles.guide, found ? styles.guideFound : null]} />

      <View style={styles.topControls}>
        <View
          accessibilityLiveRegion="polite"
          accessible
          style={[styles.feedback, found ? styles.feedbackFound : null]}
        >
          {busy ? <Spinner color="#ffffff" size="sm" /> : <View style={styles.feedbackDot} />}
          <View style={styles.feedbackCopy}>
            <Text style={styles.feedbackTitle}>{feedbackTitle}</Text>
            <Text numberOfLines={1} style={styles.feedbackDetail}>
              {feedbackDetail}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={torch ? "Turn torch off" : "Turn torch on"}
          accessibilityRole="button"
          disabled={status !== "ready" || busy}
          hitSlop={10}
          onPress={() => setTorch((current) => !current)}
          style={[styles.torch, torch ? styles.torchActive : null]}
        >
          <Text style={[styles.torchLabel, torch ? styles.torchLabelActive : null]}>
            {torch ? "Torch on" : "Torch"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.captureRow}>
        <Pressable
          accessibilityHint={`Reads ${mode === "product" ? "product" : "batch and expiry"} text from the camera`}
          accessibilityLabel={busy ? "Reading label" : "Read label"}
          accessibilityRole="button"
          disabled={!ready || status !== "ready" || busy}
          onPress={() => void capture()}
          style={({ pressed }) => [
            styles.shutterOuter,
            !ready || status !== "ready" || busy ? styles.shutterDisabled : null,
            pressed ? styles.shutterPressed : null,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 16,
    gap: 8,
    height: 360,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  fallbackText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  fallbackTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  permission: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 16,
    gap: 16,
    minHeight: 320,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  permissionCopy: { gap: 6 },
  permissionText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  permissionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  shell: {
    height: 360,
    overflow: "hidden",
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#111111",
  },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.14)",
  },
  guide: {
    position: "absolute",
    top: 94,
    right: 30,
    bottom: 94,
    left: 30,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.86)",
    borderRadius: 22,
    borderCurve: "continuous",
  },
  guideFound: {
    borderColor: "#34d399",
    borderWidth: 3,
  },
  topControls: {
    position: "absolute",
    top: 14,
    right: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  feedback: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
  },
  feedbackFound: {
    backgroundColor: "rgba(4, 120, 87, 0.88)",
  },
  feedbackDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#ffffff",
  },
  feedbackCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  feedbackTitle: {
    color: "#ffffff",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  feedbackDetail: {
    color: "rgba(255, 255, 255, 0.76)",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  torch: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
  },
  torchActive: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
  },
  torchLabel: {
    color: "#ffffff",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  torchLabelActive: {
    color: "#111111",
  },
  captureRow: {
    position: "absolute",
    right: 0,
    bottom: 18,
    left: 0,
    alignItems: "center",
  },
  shutterOuter: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#ffffff",
    borderRadius: 34,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ffffff",
  },
  shutterDisabled: {
    opacity: 0.46,
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.86,
  },
});
