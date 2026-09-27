import { nativeClient } from "@store/auth";

import type { AppHost } from "@/host";
import { controlNewSaleShortcut } from "@/lib/new-sale-shortcut";

type PreloadBridges = Pick<
  Window,
  "auth" | "serverApi" | "desktopShell" | "updater" | "electronTheme"
>;

/** The preload bridge, adapted to the host contract without changing what it does. */
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
  };
};
