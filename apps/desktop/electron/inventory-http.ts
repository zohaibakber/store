import type { InventoryHttpConfig } from "@store/web/host/electron";
import type { IpcMain } from "electron";

import { INVENTORY_HTTP_CONFIG_CHANNEL } from "./ipc-channels";
import { trustedIpcListener } from "./ipc-sender";

export const registerInventoryHttpIpc = (options: {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  readonly allowedOrigins: () => ReadonlyArray<string>;
}) => {
  options.ipcMain.handle(
    INVENTORY_HTTP_CONFIG_CHANNEL,
    trustedIpcListener(options.allowedOrigins, (): InventoryHttpConfig => ({
      apiBaseUrl: options.apiBaseUrl,
      deviceId: options.deviceId,
    })),
  );

  return () => {
    options.ipcMain.removeHandler(INVENTORY_HTTP_CONFIG_CHANNEL);
  };
};
