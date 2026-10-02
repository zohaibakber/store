import type { AuthIpcBridge } from "./auth-channels";
import type { WorkspaceBackupIpcBridge } from "./backup-channels";
import type { InventoryHttpBridge } from "./inventory-http-channels";
import type { DesktopShellIpcBridge } from "./new-sale-channels";
import type { WorkspacePublishIpcBridge } from "./publish-channels";
import type { ReplicaIpcBridge } from "./replica-channels";
import type { ServerApiIpcBridge } from "./server-api-channels";
import type { ShareIpcBridge } from "./share-channels";
import type { ThemeIpcBridge } from "./theme-channels";
import type { UpdaterIpcBridge } from "./updater-channels";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
      VITE_SENTRY_DSN?: string;
    }
  }

  interface Window {
    inventoryHttp?: InventoryHttpBridge;
    replica?: ReplicaIpcBridge;
    workspaceBackup?: WorkspaceBackupIpcBridge;
    sharing?: ShareIpcBridge;
    workspacePublish?: WorkspacePublishIpcBridge;
    electronTheme?: ThemeIpcBridge;
    desktopShell?: DesktopShellIpcBridge;
    auth?: AuthIpcBridge;
    serverApi?: ServerApiIpcBridge;
    updater?: UpdaterIpcBridge;
  }
}

export {};
