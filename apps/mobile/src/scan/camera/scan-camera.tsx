import * as React from "react";
import { StyleSheet } from "react-native";
import {
  Camera,
  type CameraDevice,
  type CameraPhotoOutput,
  CommonResolutions,
  useFrameOutput,
} from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-mlkit";
import { createSynchronizable, scheduleOnRN } from "react-native-worklets";

export type LiveTextBlock = {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type LiveTextFrame = {
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly blocks: ReadonlyArray<LiveTextBlock>;
};

export const EMPTY_LIVE_TEXT: LiveTextFrame = { width: 0, height: 0, text: "", blocks: [] };

export const MAX_LIVE_BLOCKS = 16;
const LIVE_TEXT_INTERVAL_MILLIS = 220;

type ScanCameraProps = {
  readonly device: CameraDevice;
  readonly active: boolean;
  readonly torch: boolean;
  readonly photoOutput: CameraPhotoOutput;
  readonly onLiveText: (frame: LiveTextFrame) => void;
  readonly onPreviewStarted: () => void;
  readonly onError: (error: Error) => void;
};

const frameProcessorsInstalled = (() => {
  try {
    require("react-native-vision-camera-worklets");
    return true;
  } catch {
    return false;
  }
})();

function LiveTextCamera({
  device,
  active,
  torch,
  photoOutput,
  onLiveText,
  onPreviewStarted,
  onError,
}: ScanCameraProps) {
  const { textRecognition } = useTextRecognition({ language: "LATIN" });
  const [lastRun] = React.useState(() => createSynchronizable(0));
  const latestOnLiveText = React.useRef(onLiveText);
  React.useEffect(() => {
    latestOnLiveText.current = onLiveText;
  }, [onLiveText]);
  const [deliver] = React.useState(() => (frame: LiveTextFrame) => latestOnLiveText.current(frame));
  const frameOutput = useFrameOutput({
    targetResolution: CommonResolutions.VGA_4_3,
    pixelFormat: "yuv",
    dropFramesWhileBusy: true,
    onFrame(frame) {
      "worklet";
      try {
        const now = Date.now();
        if (now - lastRun.getDirty() < LIVE_TEXT_INTERVAL_MILLIS) return;
        lastRun.setBlocking(now);
        const result = textRecognition(frame);
        const upright = frame.orientation === "left" || frame.orientation === "right";
        scheduleOnRN(deliver, {
          width: upright ? frame.height : frame.width,
          height: upright ? frame.width : frame.height,
          text: result.text,
          blocks: result.blocks.slice(0, MAX_LIVE_BLOCKS).map((block) => ({
            text: block.text,
            left: block.bounds.left,
            top: block.bounds.top,
            width: block.bounds.width,
            height: block.bounds.height,
          })),
        });
      } finally {
        frame.dispose();
      }
    },
  });
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      outputs={[photoOutput, frameOutput]}
      torchMode={torch ? "on" : "off"}
      resizeMode="cover"
      enableNativeTapToFocusGesture
      onPreviewStarted={onPreviewStarted}
      onError={onError}
    />
  );
}

function StillCamera({
  device,
  active,
  torch,
  photoOutput,
  onPreviewStarted,
  onError,
}: ScanCameraProps) {
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      outputs={[photoOutput]}
      torchMode={torch ? "on" : "off"}
      resizeMode="cover"
      enableNativeTapToFocusGesture
      onPreviewStarted={onPreviewStarted}
      onError={onError}
    />
  );
}

export const liveTextAvailable = frameProcessorsInstalled;

export const ScanCamera = frameProcessorsInstalled ? LiveTextCamera : StillCamera;
