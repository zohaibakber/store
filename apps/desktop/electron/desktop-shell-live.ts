import path from "node:path";

import type { DeviceLabel } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { app, clipboard, dialog, MessageChannelMain, nativeTheme, shell } from "electron";

import { DesktopShell, OpenExternalFailed } from "./desktop-shell";
import { DialogFailed, type Dialogs } from "./dialogs";
import { MainWindow } from "./main-window";

export interface DesktopShellConfig {
  readonly apiBaseUrl: string;
  readonly workerPath: string;
  readonly deviceLabel: DeviceLabel | undefined;
  readonly oauthRedirectUri: string;
}

const BACKUP_FILE_FILTERS = [{ name: "Tabaaq backup", extensions: ["sqlite"] }];

const showDialog = <A>(show: () => Promise<A>) =>
  Effect.tryPromise({
    try: show,
    catch: (cause) => new DialogFailed({ message: "The file dialog could not be opened.", cause }),
  });

const makeDialogs = (window: MainWindow["Service"]): Dialogs => {
  // Dialogs are modal to the main window while it is open.
  const chooseSavePath = (options: Electron.SaveDialogOptions) =>
    Effect.flatMap(window.current, (parent) =>
      showDialog(() =>
        Option.isSome(parent)
          ? dialog.showSaveDialog(parent.value, options)
          : dialog.showSaveDialog(options),
      ),
    ).pipe(
      Effect.map((chosen) =>
        chosen.canceled || chosen.filePath === "" ? Option.none() : Option.some(chosen.filePath),
      ),
    );

  const chooseOpenPath = (options: Electron.OpenDialogOptions) =>
    Effect.flatMap(window.current, (parent) =>
      showDialog(() =>
        Option.isSome(parent)
          ? dialog.showOpenDialog(parent.value, options)
          : dialog.showOpenDialog(options),
      ),
    ).pipe(
      Effect.map((chosen) =>
        chosen.canceled ? Option.none() : Option.fromNullishOr(chosen.filePaths[0]),
      ),
    );

  return {
    chooseBackupDestination: (suggestedName) =>
      chooseSavePath({
        title: "Back up to file",
        buttonLabel: "Back up",
        defaultPath: path.join(app.getPath("documents"), suggestedName),
        filters: BACKUP_FILE_FILTERS,
      }),
    chooseBackupSource: Effect.suspend(() =>
      chooseOpenPath({
        title: "Restore from file",
        buttonLabel: "Choose backup",
        defaultPath: app.getPath("documents"),
        filters: BACKUP_FILE_FILTERS,
        properties: ["openFile"],
      }),
    ),
    choosePdfDestination: (suggestedName) =>
      chooseSavePath({
        title: "Save as PDF",
        buttonLabel: "Save",
        defaultPath: path.join(app.getPath("documents"), suggestedName),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      }),
  };
};

/** The Electron side of `DesktopShell`: paths, dialogs and window controls. */
export const layerDesktopShell = (config: DesktopShellConfig) =>
  Layer.effect(
    DesktopShell,
    Effect.gen(function* () {
      const window = yield* MainWindow;
      return DesktopShell.of({
        apiBaseUrl: config.apiBaseUrl,
        userDataPath: app.getPath("userData"),
        workerPath: config.workerPath,
        deviceLabel: config.deviceLabel,
        rendererChannel: () => new MessageChannelMain(),
        oauthRedirectUri: config.oauthRedirectUri,
        dialogs: makeDialogs(window),
        minimizeWindow: window.use((current) => current.minimize()),
        toggleMaximizeWindow: window.use((current) =>
          current.isMaximized() ? current.unmaximize() : current.maximize(),
        ),
        closeWindow: window.use((current) => current.close()),
        setThemeSource: (source) =>
          Effect.sync(() => {
            nativeTheme.themeSource = source;
          }),
        openExternal: (url) =>
          Effect.tryPromise({
            try: () => shell.openExternal(url),
            catch: (cause) =>
              new OpenExternalFailed({ message: "The link could not be opened.", cause }),
          }),
        writeClipboardText: (text) => Effect.sync(() => clipboard.writeText(text)),
      });
    }),
  );
