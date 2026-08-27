import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OrganizationCommand, TokenSet } from "@store/auth";
import { DEFAULT_ELECTRON_PROTOCOL, fallbackIfBlank } from "@store/auth/security";
import { invoiceUploadRejection, MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import { fetchOrganizationRoster, organizeOrganization } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session, shell } from "electron";

import { AuthBroker } from "./auth";
import { registerInventoryHttpIpc } from "./inventory-http";
import { assertTrustedIpcSender } from "./ipc-sender";
import { makeOAuthCallbackMailbox } from "./oauth-callback-mailbox";
import {
  desktopRendererOrigin,
  desktopRendererUrl,
  makeDesktopContentSecurityPolicy,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { forwardRendererLogs } from "./report-renderer-logs";
import { initDesktopSentry, reportDesktopError } from "./sentry";
import { denyAllSessionPermissionRequests } from "./session-permissions";
import { makeShutdownCoordinator } from "./shutdown";
import { setupUpdater } from "./updater";
import { registerWebContentsSecurity } from "./web-contents-security";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "..", "web", "public")
  : RENDERER_DIST;

// Turbo runs tasks with a filtered environment, so local API configuration is
// also read from .env files. Earlier files and pre-set shell variables win.
const envFiles = [
  path.join(process.env.APP_ROOT, ".env"),
  path.join(process.env.APP_ROOT, "..", "..", ".env"),
];
for (const file of envFiles) {
  try {
    process.loadEnvFile(file);
  } catch {}
}

initDesktopSentry();

let win: BrowserWindow | null;
let disposeUpdater: (() => Promise<void>) | undefined;
let disposeInventoryHttp: (() => void) | undefined;

function appIconPath() {
  // BrowserWindow's `icon` option goes through nativeImage, which reads the
  // real filesystem and can't see into app.asar. Packaged builds load the
  // icon from extraResources, not from renderer assets. Unpackaged/dev uses
  // the orange mark; packaged/prod uses the monochrome mark.
  return app.isPackaged
    ? path.join(process.resourcesPath, "logo.png")
    : path.join(process.env.VITE_PUBLIC, "logo-dev.png");
}
// Packaged apps ship no .env, so the API URL is baked in at build time via
// `import.meta.env` (dot access on purpose, Vite inlines it); the bracket
// process.env reads stay as runtime overrides for local development.
const API_BASE_URL = fallbackIfBlank(
  process.env["STORE_API_URL"] ||
    (VITE_DEV_SERVER_URL
      ? "http://localhost:8787"
      : (process.env["VITE_API_URL"] ?? import.meta.env.VITE_API_URL)),
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

// Chromium's experimental Wayland color-management path logs errors on
// compositors that advertise the protocol without supporting its sRGB image
// description. Tabaaq is SDR-only, so use Chromium's established SDR path.
if (process.platform === "linux" && process.env["WAYLAND_DISPLAY"]) {
  const disabled = app.commandLine.getSwitchValue("disable-features").split(",").filter(Boolean);
  if (!disabled.includes("WaylandWpColorManagerV1")) {
    app.commandLine.appendSwitch(
      "disable-features",
      [...disabled, "WaylandWpColorManagerV1"].join(","),
    );
  }
}

const TITLE_BAR_HEIGHT = 40;
const TITLE_BAR_COLOR = "#01000000";
const TITLE_BAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLE_BAR_DARK_SYMBOL_COLOR = "#f8fafc";

registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
Menu.setApplicationMenu(null);

const authBroker = new AuthBroker(API_BASE_URL, AUTH_BASE_URL, `${ELECTRON_PROTOCOL}://app`);
const oauthCallbacks = makeOAuthCallbackMailbox(ELECTRON_PROTOCOL, () => {
  win?.webContents.send("auth:oauth-callback-available");
});

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

async function loadDeviceId() {
  const file = path.join(app.getPath("userData"), "device-id");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const created = crypto.randomUUID();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, created, { mode: 0o600 });
    return created;
  }
}

let authTransition: Promise<void> = Promise.resolve();

const serializeAuthTransition = <A>(transition: () => Promise<A>): Promise<A> => {
  const result = authTransition.then(transition, transition);
  authTransition = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const publishSession = (snapshot: WorkspaceSnapshot) => {
  win?.webContents.send("auth:session-changed", snapshot);
  return snapshot;
};

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
    return `${ELECTRON_PROTOCOL}://auth/callback`;
  });
  ipcMain.handle("auth:take-oauth-callback", (event) => {
    assertRendererIpc(event.senderFrame);
    return oauthCallbacks.take();
  });
  ipcMain.handle("auth:adopt-session", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    const tokens = input === undefined ? null : Schema.decodeUnknownSync(AuthTokens)(input);
    return serializeAuthTransition(() => authBroker.adoptSession(tokens).then(publishSession));
  });
  ipcMain.handle("auth:renew-session", (event) => {
    assertRendererIpc(event.senderFrame);
    return serializeAuthTransition(() => authBroker.renewSession().then(publishSession));
  });
  ipcMain.handle("auth:sign-out", (event) => {
    assertRendererIpc(event.senderFrame);
    return serializeAuthTransition(async () => {
      await authBroker.signOut();
      publishSession(authBroker.snapshot);
    });
  });
  ipcMain.handle("auth:organization", (event) => {
    assertRendererIpc(event.senderFrame);
    return fetchOrganizationRoster((pathname, init) => authBroker.authRequest(pathname, init));
  });
  ipcMain.handle("auth:organize", async (event, input) => {
    assertRendererIpc(event.senderFrame);
    const command = Schema.decodeUnknownSync(OrganizationCommand)(input);
    return organizeOrganization(
      (pathname, init) => authBroker.authRequest(pathname, init),
      command,
    );
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
    const rejection = invoiceUploadRejection(
      upload.files.map((file) => ({ byteLength: file.bytes.byteLength })),
    );
    if (rejection) throw new Error(rejection);
    const body = new FormData();
    for (const file of upload.files) {
      const inferredType = file.name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "text/csv";
      body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
    }
    const raw = await authBroker.apiRequest("/api/uploads", { method: "POST", body });
    return await Effect.runPromise(
      Schema.decodeUnknownEffect(InvoiceExtraction)(raw).pipe(
        Effect.mapError(() => new Error("Invoice analysis returned an unexpected response.")),
      ),
    );
  });
}

function createWindow() {
  win = new BrowserWindow({
    icon: appIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#161616" : "#ffffff",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: TITLE_BAR_COLOR,
            height: TITLE_BAR_HEIGHT,
            symbolColor: nativeTheme.shouldUseDarkColors
              ? TITLE_BAR_DARK_SYMBOL_COLOR
              : TITLE_BAR_LIGHT_SYMBOL_COLOR,
          },
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
  forwardRendererLogs(win);

  win.on("closed", () => {
    win = null;
  });

  void win.loadURL(desktopRendererUrl(ELECTRON_PROTOCOL));
}

nativeTheme.on("updated", () => {
  if (!win || win.isDestroyed()) return;

  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f5f5f4");
  if (process.platform !== "darwin") {
    win.setTitleBarOverlay({
      color: TITLE_BAR_COLOR,
      height: TITLE_BAR_HEIGHT,
      symbolColor: nativeTheme.shouldUseDarkColors
        ? TITLE_BAR_DARK_SYMBOL_COLOR
        : TITLE_BAR_LIGHT_SYMBOL_COLOR,
    });
  }
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

const publishOAuthCallback = (url: string) => {
  oauthCallbacks.offer(url);
};

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
  registerAuthIpc();
  registerServerIpc();
  createWindow();
  const deviceId = await loadDeviceId();
  disposeInventoryHttp = registerInventoryHttpIpc({
    apiBaseUrl: API_BASE_URL,
    auth: authBroker,
    deviceId,
    ipcMain,
    allowedOrigins: allowedRendererOrigins,
  });
  await authBroker.initialize();
  publishSession(authBroker.snapshot);
  if (app.isPackaged) disposeUpdater = await setupUpdater(() => win, allowedRendererOrigins);
});
