import { nativeClient } from "@store/auth";

import type { AppHost } from "@/host";
import { controlNewSaleShortcut } from "@/lib/new-sale-shortcut";
import { decodedBackupBridge } from "@/lib/workspace-backup";
import { decodedPublishBridge } from "@/lib/workspace-publish";

type PreloadBridges = Pick<
  Window,
  | "auth"
  | "serverApi"
  | "desktopShell"
  | "updater"
  | "electronTheme"
  | "workspaceBackup"
  | "workspacePublish"
>;

export const electronAppHost = (bridges: PreloadBridges): AppHost => {
  const { auth, serverApi } = bridges;
  if (!auth || !serverApi) throw new Error("Desktop authentication bridge is unavailable.");
  return {
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
    publish: bridges.workspacePublish && decodedPublishBridge(bridges.workspacePublish),
  };
};
