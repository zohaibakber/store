import type { BrowserWindow } from "electron";

export const forwardRendererLogs = (window: BrowserWindow) => {
  window.webContents.on("console-message", (event) => {
    if (event.level === "debug" || event.level === "info") return;
    const location = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : "";
    console.error(`[renderer ${event.level}] ${event.message}${location}`);
  });
  window.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive.");
  });
};
