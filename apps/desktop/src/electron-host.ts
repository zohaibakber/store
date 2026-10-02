import type { AppHost } from "@/host";
import { remoteFailureMessage } from "@/lib/errors";
import { controlNewSaleShortcut } from "@/lib/new-sale-shortcut";
import { decodedShareBridge } from "@/lib/share";
import { decodedBackupBridge } from "@/lib/workspace-backup";
import { decodedPublishBridge } from "@/lib/workspace-publish";

const withServerMessage = <A>(reply: Promise<A>): Promise<A> =>
  reply.catch((cause: unknown) => {
    throw cause instanceof Error
      ? new Error(remoteFailureMessage(cause.message), { cause })
      : cause;
  });

type PreloadBridges = Pick<
  Window,
  | "auth"
  | "serverApi"
  | "desktopShell"
  | "updater"
  | "electronTheme"
  | "workspaceBackup"
  | "sharing"
  | "workspacePublish"
>;

export const electronAppHost = (bridges: PreloadBridges): AppHost => {
  const { auth, serverApi, sharing } = bridges;
  if (!auth || !serverApi) throw new Error("Desktop authentication bridge is unavailable.");
  if (!sharing) throw new Error("Desktop sharing bridge is unavailable.");
  return {
    ...decodedShareBridge(sharing),
    auth,
    signIn: {
      identify: (input) => withServerMessage(auth.identify(input)),
      authenticate: (credentials) => withServerMessage(auth.authenticate(credentials)),
      beginGoogle: () => withServerMessage(auth.beginGoogle()),
      completeGoogle: (callbackUrl) => withServerMessage(auth.completeGoogle(callbackUrl)),
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
