import path from "node:path";
import { fileURLToPath } from "node:url";

import { OrganizationCommand, TokenSet } from "@store/auth";
import { DEFAULT_ELECTRON_PROTOCOL, fallbackIfBlank } from "@store/auth/security";
import { MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session, shell } from "electron";

import { AuthBroker } from "./auth";
import { makeDesktopContentSecurityPolicy } from "./content-security-policy";
import { loadDeviceId } from "./device-id";
import { makeReplicaSyncApiRequest, registerInventoryHttpIpc } from "./inventory-http";
import { assertTrustedIpcSender } from "./ipc-sender";
import { registerNewSaleAccelerator } from "./new-sale-accelerator";
import {
  isOAuthCallbackUrl,
  OAUTH_CALLBACK_CHANNEL,
  oauthCallbackRedirectUri,
} from "./oauth-callback";
import {
  desktopRendererOrigin,
  desktopRendererUrl,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { registerReplicaWorkerIpc } from "./replica-ipc";
import { forwardRendererLogs } from "./report-renderer-logs";
import { initDesktopSentry, reportDesktopError } from "./sentry";
import { denyAllSessionPermissionRequests } from "./session-permissions";
import { makeShutdownCoordinator } from "./shutdown";
import { setupUpdater } from "./updater";
import { registerWebContentsSecurity } from "./web-contents-security";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

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

const packagedExtraResourceIconPath = () => path.join(process.resourcesPath, "logo.png");
const unpackagedDevMarkPath = () => path.join(process.env.VITE_PUBLIC, "logo-dev.png");
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

const TITLE_BAR_HEIGHT = 40;
const WINDOW_LIGHT_BACKGROUND = "#ffffff";
const WINDOW_DARK_BACKGROUND = "#161616";
const TITLE_BAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLE_BAR_DARK_SYMBOL_COLOR = "#f8fafc";

const windowBackground = () =>
  nativeTheme.shouldUseDarkColors ? WINDOW_DARK_BACKGROUND : WINDOW_LIGHT_BACKGROUND;

const titleBarOverlay = () => ({
  color: `${windowBackground()}00`,
  height: TITLE_BAR_HEIGHT,
  symbolColor: nativeTheme.shouldUseDarkColors
    ? TITLE_BAR_DARK_SYMBOL_COLOR
    : TITLE_BAR_LIGHT_SYMBOL_COLOR,
});

registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
Menu.setApplicationMenu(null);

const publishSession = (snapshot: WorkspaceSnapshot) => {
  win?.webContents.send("auth:session-changed", snapshot);
  return snapshot;
};

const authBroker = new AuthBroker(API_BASE_URL, AUTH_BASE_URL, publishSession);

let pendingOAuthCallback: string | null = null;

const deliverOAuthCallback = () => {
  if (!pendingOAuthCallback || !win || win.webContents.isLoading()) return;
  win.webContents.send(OAUTH_CALLBACK_CHANNEL, pendingOAuthCallback);
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
  authOrigin: new URL(AUTH_BASE_URL).origin,
  development: Boolean(VITE_DEV_SERVER_URL),
});

const allowedRendererOrigins = () =>
  [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter((value): value is string =>
    Boolean(value),
  );

const assertRendererIpc = (frame: Electron.WebFrameMain | null | undefined) =>
  assertTrustedIpcSender(frame, allowedRendererOrigins());

function registerRendererCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [rendererCsp],
      },
    });
  });
}

const authTransitions = Semaphore.makeUnsafe(1);

const serializeAuthTransition = <A>(transition: () => Promise<A>): Promise<A> =>
  Effect.runPromise(authTransitions.withPermit(Effect.promise(transition)));

const AuthTokens = Schema.NullOr(TokenSet);
const InvoiceUpload = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.String,
      bytes: Schema.instanceOf(ArrayBuffer),
    }),
  ).check(Schema.isMaxLength(MAX_INVOICE_UPLOAD_FILES)),
});
const ThemeSource = Schema.Literals(["dark", "light", "system"]);

function registerAuthIpc() {
  ipcMain.handle("auth:get-session", (event) => {
    assertRendererIpc(event.senderFrame);
    return authBroker.snapshot;
  });
  ipcMain.handle("auth:get-oauth-redirect-uri", (event) => {
    assertRendererIpc(event.senderFrame);
    return oauthCallbackRedirectUri(ELECTRON_PROTOCOL);
  });
  ipcMain.handle("auth:adopt-session", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    const tokens = input === undefined ? null : Schema.decodeUnknownSync(AuthTokens)(input);
    return serializeAuthTransition(() => authBroker.adoptSession(tokens));
  });
  ipcMain.handle("auth:renew-session", (event) => {
    assertRendererIpc(event.senderFrame);
    return serializeAuthTransition(() => authBroker.renewSession());
  });
  ipcMain.handle("auth:sign-out", (event) => {
    assertRendererIpc(event.senderFrame);
    return serializeAuthTransition(() => authBroker.signOut());
  });
  ipcMain.handle("auth:organization", (event) => {
    assertRendererIpc(event.senderFrame);
    return authBroker.organizationRoster();
  });
  ipcMain.handle("auth:organize", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    return authBroker.organize(Schema.decodeUnknownSync(OrganizationCommand)(input));
  });
  ipcMain.handle("auth:open-external", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    const url = Schema.decodeUnknownSync(Schema.String)(input);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") {
      throw new Error("Only Google authorization URLs can be opened.");
    }
    await shell.openExternal(parsed.href);
  });
}

function registerServerIpc() {
  ipcMain.handle("server:uploads", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    const upload = Schema.decodeUnknownSync(InvoiceUpload)(input);
    return authBroker.analyseInvoices(upload.files);
  });
}

const publishReplicaForeground = (visible: boolean) => {
  replicaWorker
    ?.setForeground(visible)
    .catch((cause: unknown) => reportDesktopError(cause, { op: "replica-foreground" }));
};

function createWindow() {
  win = new BrowserWindow({
    icon: appIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: titleBarOverlay(),
        }),
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
  win.webContents.on("did-finish-load", deliverOAuthCallback);
  forwardRendererLogs(win);

  win.on("closed", () => {
    win = null;
  });
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
  if (process.platform !== "darwin") win.setTitleBarOverlay(titleBarOverlay());
});

ipcMain.on("theme:set-source", (event, input) => {
  try {
    assertRendererIpc(event.senderFrame);
  } catch {
    return;
  }
  const source = Schema.decodeUnknownOption(ThemeSource)(input);
  if (source._tag === "Some") nativeTheme.themeSource = source.value;
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
  registerRendererCsp();
  denyAllSessionPermissionRequests(session.defaultSession);
  registerWebContentsSecurity(allowedRendererOrigins);
  registerNewSaleAccelerator();
  registerAuthIpc();
  registerServerIpc();
  createWindow();
  const deviceId = await loadDeviceId(app.getPath("userData"));
  disposeInventoryHttp = registerInventoryHttpIpc({
    apiBaseUrl: API_BASE_URL,
    deviceId,
    ipcMain,
    allowedOrigins: allowedRendererOrigins,
  });
  replicaWorker = registerReplicaWorkerIpc({
    ipcMain,
    userDataPath: app.getPath("userData"),
    workerPath: path.join(MAIN_DIST, "replica-worker.js"),
    apiBaseUrl: API_BASE_URL,
    syncApiRequest: makeReplicaSyncApiRequest(API_BASE_URL, authBroker.apiFetch),
    liveAccessToken: (force) => authBroker.liveAccessToken(force),
    allowedOrigins: allowedRendererOrigins,
  });
  await authBroker.initialize();
  publishSession(authBroker.snapshot);
  if (app.isPackaged) disposeUpdater = await setupUpdater(() => win, allowedRendererOrigins);
});
