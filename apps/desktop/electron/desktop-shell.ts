import type { DeviceLabel } from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { MessageChannelMain, WebContents } from "electron";

import type { ThemeSource } from "../src/host/shell-rpcs";
import type { ReplicaBackupDialogs } from "./replica-backup";
import type { ReplicaSender } from "./workspace-sessions";

export type ShellSender = ReplicaSender & Pick<WebContents, "print" | "printToPDF">;

export class ShellConnection extends Context.Service<
  ShellConnection,
  { readonly sender: ShellSender }
>()("@store/desktop/ShellConnection") {}

export class DesktopShell extends Context.Service<
  DesktopShell,
  {
    readonly apiBaseUrl: string;
    readonly userDataPath: string;
    readonly workerPath: string;
    readonly deviceLabel: DeviceLabel | undefined;
    readonly rendererChannel: () => MessageChannelMain;
    readonly oauthRedirectUri: string;
    readonly backupDialogs: ReplicaBackupDialogs;
    readonly minimizeWindow: Effect.Effect<void>;
    readonly toggleMaximizeWindow: Effect.Effect<void>;
    readonly closeWindow: Effect.Effect<void>;
    readonly setThemeSource: (source: ThemeSource) => Effect.Effect<void>;
    readonly openExternal: (url: string) => Effect.Effect<void, Error>;
    readonly writeClipboardText: (text: string) => Effect.Effect<void>;
    readonly choosePdfDestination: (suggestedName: string) => Effect.Effect<string | null>;
  }
>()("@store/desktop/DesktopShell") {}
