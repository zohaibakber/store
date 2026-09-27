import { isAllowedRendererNavigation } from "./renderer-navigation";

export type TrustedIpcSenderFrame = {
  readonly url: string;
  readonly detached?: boolean;
};

const frameReportsDetached = (frame: TrustedIpcSenderFrame) => {
  try {
    return Boolean(frame.detached);
  } catch {
    return false;
  }
};

export const isTrustedIpcSenderFrame = (
  frame: TrustedIpcSenderFrame | null | undefined,
  allowedOrigins: ReadonlyArray<string>,
) => {
  if (!frame) return false;
  if (frameReportsDetached(frame)) return false;
  return isAllowedRendererNavigation(frame.url, allowedOrigins);
};

export const assertTrustedIpcSender = (
  frame: TrustedIpcSenderFrame | null | undefined,
  allowedOrigins: ReadonlyArray<string>,
) => {
  if (!isTrustedIpcSenderFrame(frame, allowedOrigins)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
};
