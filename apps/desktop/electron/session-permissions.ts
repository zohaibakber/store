import type { Session } from "electron";

/** Deny every Chromium permission prompt. The renderer does not need them. */
export const denyAllSessionPermissionRequests = (session: Session) => {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
};
