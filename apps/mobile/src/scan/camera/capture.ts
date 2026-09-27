import type { CameraPhotoOutput } from "react-native-vision-camera";
import {
  type TextRecognitionResult,
  processImageTextRecognition,
} from "react-native-vision-camera-mlkit";

import type { LiveTextFrame } from "./scan-camera";

export type CapturedScan = {
  readonly path: string;
  readonly text: string;
  readonly lines: ReadonlyArray<string>;
};

const MAX_CHIP_LINES = 40;

const fileUri = (path: string) => (path.startsWith("file://") ? path : `file://${path}`);

const uniqueLines = (texts: Iterable<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const lines: Array<string> = [];
  for (const text of texts) {
    const line = text.replace(/\s+/g, " ").trim();
    const key = line.toLowerCase();
    if (line.length < 2 || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length === MAX_CHIP_LINES) break;
  }
  return lines;
};

const recognizedLines = (result: TextRecognitionResult) =>
  uniqueLines(result.blocks.flatMap((block) => block.lines.map((line) => line.text)));

export const captureScan = async (
  photoOutput: CameraPhotoOutput,
  liveText: LiveTextFrame,
): Promise<CapturedScan> => {
  const photo = await photoOutput.capturePhotoToFile(
    { flashMode: "off", enableShutterSound: false },
    {},
  );
  const recognized = await processImageTextRecognition(fileUri(photo.filePath), {
    language: "LATIN",
  }).catch(() => null);
  if (recognized !== null && recognized.text.trim()) {
    return { path: photo.filePath, text: recognized.text, lines: recognizedLines(recognized) };
  }
  return {
    path: photo.filePath,
    text: liveText.text,
    lines: uniqueLines(liveText.text.split("\n")),
  };
};
