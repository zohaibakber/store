import { app } from "electron";

import { isAllowedRendererNavigation } from "./renderer-navigation";

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
