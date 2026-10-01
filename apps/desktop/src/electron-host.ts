import { nativeClient } from "@store/auth";

import type { AppHost } from "@/host";
import { controlNewSaleShortcut } from "@/lib/new-sale-shortcut";
import { decodedShareBridge } from "@/lib/share";
import { decodedBackupBridge } from "@/lib/workspace-backup";

type PreloadBridges = Pick<
  Window,
  | "auth"
  | "serverApi"
  | "desktopShell"
  | "updater"
  | "electronTheme"
  | "workspaceBackup"
  | "sharing"
>;

export const electronAppHost = (bridges: PreloadBridges): AppHost => {
  const { auth, serverApi, sharing } = bridges;
  if (!auth || !serverApi) throw new Error("Desktop authentication bridge is unavailable.");
  if (!sharing) throw new Error("Desktop sharing bridge is unavailable.");
  return {
    ...decodedShareBridge(sharing),
    auth,
    signIn: {
      client: nativeClient("Tabaaq Desktop"),
      oauthRedirectUri: () => auth.getOAuthRedirectUri(),
      openAuthorization: (url) => auth.openExternal(url),
      onOAuthCallback: (listener) => auth.onOAuthCallback(listener),
    },
    analyseInvoices: (files) => serverApi.analyseInvoices({ files: [...files] }),
    newSaleShortcut: controlNewSaleShortcut,
    shell: bridges.desktopShell,
    updater: bridges.updater,
    theme: bridges.electronTheme,
    backup: bridges.workspaceBackup && decodedBackupBridge(bridges.workspaceBackup),
  };
};
