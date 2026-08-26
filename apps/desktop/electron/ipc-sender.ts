import type { WebFrameMain } from "electron";

import { isAllowedRendererNavigation } from "./renderer-navigation";

export const isTrustedIpcSenderFrame = (
  frame: WebFrameMain | null | undefined,
  allowedOrigins: ReadonlyArray<string>,
) => {
  if (!frame) return false;
  try {
    if (frame.detached) return false;
  } catch {
    // `detached` is unavailable on some Electron builds used in tests.
  }
  return isAllowedRendererNavigation(frame.url, allowedOrigins);
};

export const assertTrustedIpcSender = (
  frame: WebFrameMain | null | undefined,
  allowedOrigins: ReadonlyArray<string>,
) => {
  if (!isTrustedIpcSenderFrame(frame, allowedOrigins)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
};
