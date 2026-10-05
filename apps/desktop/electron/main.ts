// Must stay the first import: parsers created before it run on the interpreter.
import "effect/schema/SchemaJITCompiler/enable";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeSourceLinks } from "@store/web/host/source-links";
import * as Schema from "effect/Schema";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeTheme,
  session,
  shell,
} from "electron";

import { makeDesktopContentSecurityPolicy } from "./content-security-policy";
import { loadDeviceId } from "./device-id";
import { registerInventoryHttpIpc } from "./inventory-http";
import {
  THEME_SET_SOURCE_CHANNEL,
  WINDOW_CLOSE_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
} from "./ipc-channels";
import { isTrustedIpcSenderFrame } from "./ipc-sender";
import { makeLicenceHost } from "./licence/host";
import { registerNewSaleAccelerator } from "./new-sale-accelerator";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  desktopRendererOrigin,
  desktopRendererUrl,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { lockDownRenderer } from "./renderer-lockdown";
import type { ReplicaBackupDialogs } from "./replica-backup";
import { registerReplicaWorkerIpc } from "./replica-ipc";
import { initDesktopSentry, reportDesktopError } from "./sentry";
import { registerShareIpc } from "./share-ipc";
import { makeShutdownCoordinator } from "./shutdown";
import { readThemeSource, saveThemeSource, ThemeSource } from "./theme-source";
import { setupUpdater } from "./updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

const envFallbackFiles = [
  path.join(process.env.APP_ROOT, ".env"),
  path.join(process.env.APP_ROOT, "..", "..", ".env"),
];
for (const file of envFallbackFiles) {
  try {
    process.loadEnvFile(file);
  } catch {}
}

initDesktopSentry();

let win: BrowserWindow | null;
let disposeUpdater: (() => Promise<void>) | undefined;
let disposeInventoryHttp: (() => void) | undefined;
let replicaWorker: ReturnType<typeof registerReplicaWorkerIpc> | undefined;
let licenceHost: ReturnType<typeof makeLicenceHost> | undefined;

const packagedExtraResourceIconPath = () => path.join(process.resourcesPath, "logo.png");
const unpackagedDevMarkPath = () =>
  path.join(process.env.APP_ROOT, "assets", "dev", "logo-dev.png");
const appIconPath = () =>
  app.isPackaged ? packagedExtraResourceIconPath() : unpackagedDevMarkPath();

const fallbackIfBlank = (value: string | undefined, fallback: string) => value?.trim() || fallback;

const runtimeApiUrlOverride = process.env["STORE_API_URL"];
const viteInlinedApiUrl = import.meta.env.VITE_API_URL;
const API_BASE_URL = fallbackIfBlank(
  runtimeApiUrlOverride ||
    (VITE_DEV_SERVER_URL
      ? "http://localhost:8787"
      : (process.env["VITE_API_URL"] ?? viteInlinedApiUrl)),
  "http://localhost:8787",
);
const ELECTRON_PROTOCOL = fallbackIfBlank(
  process.env["ELECTRON_PROTOCOL"],
  DEFAULT_ELECTRON_PROTOCOL,
);

const EXPERIMENTAL_WAYLAND_COLOR_MANAGER = "WaylandWpColorManagerV1";
if (process.platform === "linux" && process.env["WAYLAND_DISPLAY"]) {
  const disabled = app.commandLine.getSwitchValue("disable-features").split(",").filter(Boolean);
  if (!disabled.includes(EXPERIMENTAL_WAYLAND_COLOR_MANAGER)) {
    app.commandLine.appendSwitch(
      "disable-features",
      [...disabled, EXPERIMENTAL_WAYLAND_COLOR_MANAGER].join(","),
    );
  }
}

const WINDOW_LIGHT_BACKGROUND = "#ffffff";
const WINDOW_DARK_BACKGROUND = "#161616";

const windowBackground = () =>
  nativeTheme.shouldUseDarkColors ? WINDOW_DARK_BACKGROUND : WINDOW_LIGHT_BACKGROUND;

registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
Menu.setApplicationMenu(null);

const rendererCsp = makeDesktopContentSecurityPolicy({
  scheme: ELECTRON_PROTOCOL,
  development: Boolean(VITE_DEV_SERVER_URL),
});

const allowedRendererOrigins = () =>
  [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter((value): value is string =>
    Boolean(value),
  );

const BACKUP_FILE_FILTERS = [{ name: "Tabaaq backup", extensions: ["sqlite"] }];

const chooseSavePath = async (options: Electron.SaveDialogOptions) => {
  const chosen = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  return chosen.canceled || chosen.filePath === "" ? null : chosen.filePath;
};

const chooseOpenPath = async (options: Electron.OpenDialogOptions) => {
  const chosen = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
};

const backupDialogs: ReplicaBackupDialogs = {
  chooseDestination: (suggestedName) =>
    chooseSavePath({
      title: "Back up to file",
      buttonLabel: "Back up",
      defaultPath: path.join(app.getPath("documents"), suggestedName),
      filters: BACKUP_FILE_FILTERS,
    }),
  chooseSource: () =>
    chooseOpenPath({
      title: "Restore from file",
      buttonLabel: "Choose backup",
      defaultPath: app.getPath("documents"),
      filters: BACKUP_FILE_FILTERS,
      properties: ["openFile"],
    }),
};

const choosePdfDestination = (suggestedName: string) =>
  chooseSavePath({
    title: "Save as PDF",
    buttonLabel: "Save",
    defaultPath: path.join(app.getPath("documents"), suggestedName),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });

const publishWindowMaximized = () => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(WINDOW_MAXIMIZED_CHANNEL, win.isMaximized());
};

function createWindow() {
  win = new BrowserWindow({
    icon: appIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: true,
      contextIsolation: true,
      devTools: !app.isPackaged,
      enableWebSQL: false,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  win.setIcon(appIconPath());
  app.dock?.setIcon(appIconPath());

  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-finish-load", publishWindowMaximized);
  win.webContents.on("console-message", (event) => {
    if (event.level === "debug" || event.level === "info") return;
    const location = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : "";
    console.error(`[renderer ${event.level}] ${event.message}${location}`);
  });
  win.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive.");
  });

  win.on("closed", () => {
    win = null;
  });
  win.on("maximize", publishWindowMaximized);
  win.on("unmaximize", publishWindowMaximized);

  void win.loadURL(desktopRendererUrl(ELECTRON_PROTOCOL));
}

nativeTheme.on("updated", () => {
  if (!win || win.isDestroyed()) return;

  win.setBackgroundColor(windowBackground());
});

const onWindowControl = (channel: string, control: (window: BrowserWindow) => void) => {
  ipcMain.on(channel, (event) => {
    if (!isTrustedIpcSenderFrame(event.senderFrame, allowedRendererOrigins())) return;
    if (!win || win.isDestroyed()) return;
    control(win);
  });
};

onWindowControl(WINDOW_MINIMIZE_CHANNEL, (window) => window.minimize());
onWindowControl(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, (window) =>
  window.isMaximized() ? window.unmaximize() : window.maximize(),
);
onWindowControl(WINDOW_CLOSE_CHANNEL, (window) => window.close());

ipcMain.on(THEME_SET_SOURCE_CHANNEL, (event, input) => {
  if (!isTrustedIpcSenderFrame(event.senderFrame, allowedRendererOrigins())) return;
  const source = Schema.decodeUnknownOption(ThemeSource)(input);
  if (source._tag === "None") return;
  nativeTheme.themeSource = source.value;
  void saveThemeSource(app.getPath("userData"), source.value).catch(() => undefined);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const shutdown = makeShutdownCoordinator({
  dispose: async () => {
    const results = await Promise.allSettled([
      disposeUpdater?.(),
      Promise.resolve(disposeInventoryHttp?.()),
      Promise.resolve(replicaWorker?.dispose()),
      licenceHost?.dispose(),
    ]);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures[0]) throw failures[0].reason;
  },
  quit: () => app.quit(),
  reportError: (cause) => reportDesktopError(cause, { op: "desktop-shutdown" }),
});

app.on("before-quit", shutdown);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

void app.whenReady().then(async () => {
  if (!primaryInstance) return;
  registerDesktopProtocolHandler({
    scheme: ELECTRON_PROTOCOL,
    rendererRoot: RENDERER_DIST,
    developmentServerUrl: VITE_DEV_SERVER_URL,
    contentSecurityPolicy: rendererCsp,
  });
  lockDownRenderer({
    session: session.defaultSession,
    allowedOrigins: allowedRendererOrigins,
    contentSecurityPolicy: rendererCsp,
  });
  registerNewSaleAccelerator();
  const sourceLinks = makeSourceLinks();
  registerShareIpc({
    ipcMain,
    allowedOrigins: allowedRendererOrigins,
    openExternal: (url) => shell.openExternal(url),
    isSourceLink: sourceLinks.allows,
    writeClipboardText: (text) => clipboard.writeText(text),
    choosePdfDestination,
  });
  nativeTheme.themeSource = readThemeSource(app.getPath("userData"));
  createWindow();
  const deviceId = await loadDeviceId(app.getPath("userData"));
  disposeInventoryHttp = registerInventoryHttpIpc({
    apiBaseUrl: API_BASE_URL,
    deviceId,
    ipcMain,
    allowedOrigins: allowedRendererOrigins,
  });
  licenceHost = makeLicenceHost({
    userDataPath: app.getPath("userData"),
    packaged: app.isPackaged,
  });
  replicaWorker = registerReplicaWorkerIpc({
    ipcMain,
    userDataPath: app.getPath("userData"),
    workerPath: path.join(MAIN_DIST, "replica-worker.js"),
    replicaId: deviceId,
    allowedOrigins: allowedRendererOrigins,
    backupDialogs,
    rendererChannel: () => new MessageChannelMain(),
    sessions: { licence: licenceHost.service },
  });
  if (app.isPackaged) disposeUpdater = await setupUpdater(() => win, allowedRendererOrigins);
});
