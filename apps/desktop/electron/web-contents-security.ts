import { app } from "electron";

import { isAllowedRendererNavigation } from "./renderer-navigation";

/**
 * Official Electron security checklist: limit navigation and new windows on
 * every WebContents, and refuse `<webview>` tags.
 */
export const registerWebContentsSecurity = (allowedOrigins: () => ReadonlyArray<string>) => {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedRendererNavigation(url, allowedOrigins())) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
};
