import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  extractTextFromImage,
  isSupported as isTextRecognitionSupported,
} from "expo-text-extractor";
import { Button } from "heroui-native/button";
import { Spinner } from "heroui-native/spinner";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { ProductScanMode } from "@/features/product-scanner/types";

type InlineTextCameraProps = {
  mode: ProductScanMode;
  active: boolean;
  disabled: boolean;
  analyzing: boolean;
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
  active,
  disabled,
  analyzing,
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

  useEffect(() => {
    setCaptureState("ready");
    setLineCount(0);
  }, [mode, resetKey]);

  useEffect(() => {
    if (active) return;
    setReady(false);
    setTorch(false);
  }, [active]);

  const capture = async () => {
    if (!ready || disabled || analyzing || captureState === "reading" || !camera.current) return;
    if (!isTextRecognitionSupported) {
      onError("Text recognition is not available on this device.");
      return;
    }

    onCaptureStateChange(true);
    setCaptureState("reading");
    setLineCount(0);
    void Haptics.selectionAsync();
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
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onError("No readable text yet. Move closer, reduce glare, and try again.");
        return;
      }

      setLineCount(lines.length);
      setCaptureState("found");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onTextDetected(recognizedText);
    } catch (cause) {
      setCaptureState("ready");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      onError(cause instanceof Error ? cause.message : "The label could not be read.");
    } finally {
      onCaptureStateChange(false);
    }
  };

  if (!active) {
    return (
      <View className="bg-surface-secondary h-90 items-center justify-center gap-2 rounded-3xl px-8">
        <Text className="text-center text-sm font-medium text-foreground">Camera paused</Text>
        <Text className="text-center text-xs leading-5 font-normal text-muted">
          Return to this screen to continue scanning.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View className="bg-surface-secondary h-80 items-center justify-center rounded-3xl">
        <Spinner color="default" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="bg-surface-secondary min-h-80 items-center justify-center gap-4 rounded-3xl px-8">
        <View className="gap-1.5">
          <Text className="text-center text-base font-medium text-foreground">
            Camera access is needed
          </Text>
          <Text className="text-center text-sm leading-5 font-normal text-muted">
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

  const busy = captureState === "reading" || analyzing;
  const found = captureState === "found";
  const feedbackTitle = disabled
    ? "Syncing inventory…"
    : analyzing
      ? "Structuring product details…"
      : captureState === "reading"
        ? "Reading label on-device…"
        : found
          ? "Text detected"
          : mode === "product"
            ? "Ready for product label"
            : "Ready for batch details";
  const feedbackDetail = disabled
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
          disabled={disabled || busy}
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
          disabled={!ready || disabled || busy}
          onPress={() => void capture()}
          style={({ pressed }) => [
            styles.shutterOuter,
            !ready || disabled || busy ? styles.shutterDisabled : null,
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
