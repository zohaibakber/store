import { deviceLabelOf, type DeviceLabel } from "@store/contracts";

type Named = { readonly name: string; readonly marks: RegExp };

const BROWSERS: ReadonlyArray<Named> = [
  { name: "Edge", marks: /\bEdg(?:e|A|iOS)?\// },
  { name: "Opera", marks: /\bOPR\// },
  { name: "Firefox", marks: /\b(?:Firefox|FxiOS)\// },
  { name: "Chrome", marks: /\b(?:Chrome|CriOS)\// },
  { name: "Safari", marks: /\bSafari\// },
];

const SYSTEMS: ReadonlyArray<Named> = [
  { name: "Windows", marks: /\bWindows\b/ },
  { name: "Android", marks: /\bAndroid\b/ },
  { name: "iOS", marks: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: "ChromeOS", marks: /\bCrOS\b/ },
  { name: "macOS", marks: /\bMac OS X\b/ },
  { name: "Linux", marks: /\bLinux\b/ },
];

const named = (candidates: ReadonlyArray<Named>, userAgent: string) =>
  candidates.find((candidate) => candidate.marks.test(userAgent))?.name;

export const browserDeviceLabel = (userAgent: string): DeviceLabel | undefined => {
  const browser = named(BROWSERS, userAgent);
  const system = named(SYSTEMS, userAgent);
  if (browser === undefined) return deviceLabelOf(system ?? "");
  return deviceLabelOf(system === undefined ? browser : `${browser} on ${system}`);
};
