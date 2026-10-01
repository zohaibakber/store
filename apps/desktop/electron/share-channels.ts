import type { ShareBridge } from "../src/lib/share";

export const SHARE_OPEN_EXTERNAL_CHANNEL = "share:open-external";
export const SHARE_COPY_TEXT_CHANNEL = "share:copy-text";
export const SHARE_SAVE_PDF_CHANNEL = "share:save-pdf";

export type ShareIpcBridge = ShareBridge;
