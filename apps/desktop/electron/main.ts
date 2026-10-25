// Must stay the first import: parsers created before it run on the interpreter.
import "effect/schema/SchemaJITCompiler/enable";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_ELECTRON_PROTOCOL, fallbackIfBlank } from "@store/auth/security";
import { deviceLabelOf } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  type MessagePortMain,
  nativeTheme,
  session,
  shell,
  type WebContents,
} from "electron";

import { SHELL_PORT_REQUEST_CHANNEL } from "../src/host/shell-port-channels";
import { DesktopAuth } from "./auth";
import { makeDesktopContentSecurityPolicy } from "./content-security-policy";
import { DesktopShell, OpenExternalFailed } from "./desktop-shell";
import { makeDesktopHost } from "./host";
import { registerNewSaleAccelerator } from "./new-sale-accelerator";
import { isOAuthCallbackUrl, oauthCallbackRedirectUri } from "./oauth-callback";
import {
  desktopRendererOrigin,
  desktopRendererUrl,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { lockDownRenderer } from "./renderer-lockdown";
import type { ReplicaBackupDialogs } from "./replica-backup";
import { ReplicaHost } from "./replica-host";
import { initDesktopSentry, reportDesktopError } from "./sentry";
import { ShellEvents } from "./shell-events";
import { makeShellPort } from "./shell-port";
import { ShellServer } from "./shell-server";
import { makeShutdownCoordinator } from "./shutdown";
import { readThemeSource } from "./theme-source";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

const envFallbackFiles = [
  path.join(process.env.APP_ROOT, ".env"),
  path.join(process.env.APP_ROOT, "..", "..", ".env"),
];
for (const file of app.isPackaged ? [] : envFallbackFiles) {
  try {
    process.loadEnvFile(file);
  } catch {}
}

initDesktopSentry();

let win: BrowserWindow | null;
let events: ShellEvents["Service"] | undefined;

const packagedExtraResourceIconPath = () => path.join(process.resourcesPath, "logo.png");
const unpackagedDevMarkPath = () =>
  path.join(process.env.APP_ROOT, "assets", "dev", "logo-dev.png");
const appIconPath = () =>
  app.isPackaged ? packagedExtraResourceIconPath() : unpackagedDevMarkPath();

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
const AUTH_BASE_URL = fallbackIfBlank(
  process.env["AUTH_BASE_URL"] ?? import.meta.env.VITE_AUTH_URL,
  "http://localhost:8788",
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

let pendingOAuthCallback: string | null = null;

const deliverOAuthCallback = () => {
  if (!pendingOAuthCallback || !events) return;
  Queue.offerUnsafe(events.oauthCallbacks, pendingOAuthCallback);
  pendingOAuthCallback = null;
};

const publishOAuthCallback = (url: string) => {
  if (!isOAuthCallbackUrl(url, ELECTRON_PROTOCOL)) return;
  pendingOAuthCallback = url;
  deliverOAuthCallback();
};

const rendererCsp = makeDesktopContentSecurityPolicy({
  scheme: ELECTRON_PROTOCOL,
  apiOrigin: new URL(API_BASE_URL).origin,
  development: Boolean(VITE_DEV_SERVER_URL),
});

const allowedRendererOrigins = () =>
  [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter((value): value is string =>
    Boolean(value),
  );

const hostDeviceLabel = () => {
  const [name = ""] = hostname().split(".");
  return name.includes("@") ? undefined : deviceLabelOf(name);
};

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

const withWindow = (control: (window: BrowserWindow) => void) =>
  Effect.sync(() => {
    if (win && !win.isDestroyed()) control(win);
  });

const desktopShell = DesktopShell.of({
  apiBaseUrl: API_BASE_URL,
  userDataPath: app.getPath("userData"),
  workerPath: path.join(MAIN_DIST, "replica-worker.js"),
  deviceLabel: hostDeviceLabel(),
  rendererChannel: () => new MessageChannelMain(),
  oauthRedirectUri: oauthCallbackRedirectUri(ELECTRON_PROTOCOL),
  backupDialogs,
  minimizeWindow: withWindow((window) => window.minimize()),
  toggleMaximizeWindow: withWindow((window) =>
    window.isMaximized() ? window.unmaximize() : window.maximize(),
  ),
  closeWindow: withWindow((window) => window.close()),
  setThemeSource: (source) =>
    Effect.sync(() => {
      nativeTheme.themeSource = source;
    }),
  openExternal: (url) =>
    Effect.tryPromise({
      try: () => shell.openExternal(url),
      catch: (cause) => new OpenExternalFailed({ message: "The link could not be opened.", cause }),
    }),
  writeClipboardText: (text) => Effect.sync(() => clipboard.writeText(text)),
  choosePdfDestination: (suggestedName) =>
    Effect.promise(() => choosePdfDestination(suggestedName)),
});

const host = makeDesktopHost({
  apiBaseUrl: API_BASE_URL,
  authBaseUrl: AUTH_BASE_URL,
  packaged: app.isPackaged,
  shell: desktopShell,
});

const publishReplicaForeground = (visible: boolean) => {
  host
    .run(ReplicaHost.use((replicas) => replicas.setForeground(visible)))
    .catch((cause: unknown) => reportDesktopError(cause, { op: "replica-foreground" }));
};

const publishWindowMaximized = () => {
  if (!win || win.isDestroyed() || !events) return;
  PubSub.publishUnsafe(events.maximized, win.isMaximized());
};

const shellPort = makeShellPort<WebContents, MessagePortMain>({
  allowedOrigins: allowedRendererOrigins,
  mainWindowContentsId: () => win?.webContents.id,
  channel: () => new MessageChannelMain(),
  serve: (sender, port) => {
    void host
      .run(ShellServer.use((server) => server.serve(sender, port)))
      .catch((cause: unknown) => reportDesktopError(cause, { op: "shell-port-serve" }));
  },
  release: (senderId) => {
    void host
      .run(ShellServer.use((server) => server.release(senderId)))
      .catch((cause: unknown) => reportDesktopError(cause, { op: "shell-port-release" }));
  },
});

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
  shellPort.attach(win.webContents);
  publishWindowMaximized();
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
  win.on("blur", () => publishReplicaForeground(false));
  win.on("minimize", () => publishReplicaForeground(false));
  win.on("hide", () => publishReplicaForeground(false));
  win.on("focus", () => publishReplicaForeground(true));
  win.on("restore", () => publishReplicaForeground(true));
  win.on("show", () => publishReplicaForeground(true));

  void win.loadURL(desktopRendererUrl(ELECTRON_PROTOCOL));
}

nativeTheme.on("updated", () => {
  if (!win || win.isDestroyed()) return;

  win.setBackgroundColor(windowBackground());
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
  dispose: () => host.dispose(),
  quit: () => app.quit(),
  reportError: (cause) => reportDesktopError(cause, { op: "desktop-shutdown" }),
});

app.on("before-quit", shutdown);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("open-url", (event, url) => {
  event.preventDefault();
  publishOAuthCallback(url);
});
app.on("second-instance", (_event, argv) => {
  const callback = argv.find((value) => value.startsWith(`${ELECTRON_PROTOCOL}://`));
  if (callback) publishOAuthCallback(callback);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

const initialOAuthCallback = process.argv.find((value) =>
  value.startsWith(`${ELECTRON_PROTOCOL}://`),
);
if (initialOAuthCallback) publishOAuthCallback(initialOAuthCallback);

void app.whenReady().then(async () => {
  if (!primaryInstance) return;
  app.setAsDefaultProtocolClient(ELECTRON_PROTOCOL);
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
  events = await host.run(ShellEvents);
  deliverOAuthCallback();
  registerNewSaleAccelerator(
    (contents) => contents.id === win?.webContents.id,
    () => {
      if (events) PubSub.publishUnsafe(events.newSale, undefined);
    },
  );
  ipcMain.on(SHELL_PORT_REQUEST_CHANNEL, (event) => {
    shellPort.request(event);
  });
  nativeTheme.themeSource = await host.run(readThemeSource(app.getPath("userData")));
  createWindow();
  void host.run(DesktopAuth.use((auth) => auth.initialize));
});
