import type { Session } from "electron";

export const denyAllSessionPermissionRequests = (session: Session) => {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
};
