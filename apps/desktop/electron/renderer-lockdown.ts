import { app, type Session } from "electron";

import { isAllowedRendererNavigation } from "./renderer-navigation";

export const lockDownRenderer = (options: {
  readonly session: Session;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly contentSecurityPolicy: string;
}) => {
  options.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [options.contentSecurityPolicy],
      },
    });
  });
  options.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  options.session.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedRendererNavigation(url, options.allowedOrigins())) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
};
