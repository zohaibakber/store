import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OrganizationCommand, TokenSet } from "@store/auth";
import { DEFAULT_ELECTRON_PROTOCOL, fallbackIfBlank } from "@store/auth/security";
import { encodeStoreError, InvoiceExtraction } from "@store/contracts";
import { OfflineStore, PersistenceError, layer as persistenceLayer } from "@store/persistence";
import {
  AuthenticatedWorkspace,
  fetchOrganizationRoster,
  invokeStoreHandler,
  organizeOrganization,
  withStoreEffect,
  type WorkspaceStoreAdapter,
  type WorkspaceTarget,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from "electron";

import { AuthBroker } from "./auth";
import {
  desktopRendererOrigin,
  desktopRendererUrl,
  makeDesktopContentSecurityPolicy,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { STORE_CHANNEL_ENTRIES, STORE_SYNC_STATUS_CHANNEL } from "./store-channels";
import { openDesktopSyncSocket } from "./sync-socket";
import { setupUpdater } from "./updater";

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

let win: BrowserWindow | null;
let workspace: AuthenticatedWorkspace | undefined;
let disposeUpdater: (() => Promise<void>) | undefined;

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

// Local commits wake the sync engine right away. The live socket usually
// carries that signal; this poll only covers a missed wakeup.
const DESKTOP_SYNC_POLL_INTERVAL_MS = 300_000;
const TITLE_BAR_HEIGHT = 40;
const TITLE_BAR_COLOR = "#01000000";
const TITLE_BAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLE_BAR_DARK_SYMBOL_COLOR = "#f8fafc";

registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
const authBroker = new AuthBroker(API_BASE_URL, AUTH_BASE_URL, `${ELECTRON_PROTOCOL}://app`);

const rendererCsp = makeDesktopContentSecurityPolicy({
  scheme: ELECTRON_PROTOCOL,
  apiOrigin: new URL(API_BASE_URL).origin,
  authOrigin: new URL(AUTH_BASE_URL).origin,
  development: Boolean(VITE_DEV_SERVER_URL),
});

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

type StoreIpcResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false;
      readonly error: unknown;
    };

const ErrorDetails = Schema.Struct({ message: Schema.String });
const errorMessage = (cause: unknown) => {
  const details = Schema.decodeUnknownOption(ErrorDetails)(cause);
  return details._tag === "Some" ? details.value.message : String(cause);
};

const encodeStoreErrorSafely = (cause: unknown) => {
  try {
    return encodeStoreError(cause);
  } catch {
    return encodeStoreError(
      PersistenceError.make({ operation: "run store", message: errorMessage(cause) }),
    );
  }
};

const runStore = async <A, E>(
  effect: Effect.Effect<A, E, OfflineStore>,
): Promise<StoreIpcResult<A>> => {
  if (!workspace)
    return {
      ok: false,
      error: encodeStoreError(
        PersistenceError.make({
          operation: "run store",
          message: "Local store isn't ready yet",
        }),
      ),
    };
  try {
    return { ok: true, value: await workspace.runStore(effect) };
  } catch (cause) {
    return { ok: false, error: encodeStoreErrorSafely(cause) };
  }
};

const withStore = withStoreEffect;

function registerStoreIpc() {
  for (const [method, channel] of STORE_CHANNEL_ENTRIES)
    ipcMain.handle(channel, (_event, input) => runStore(invokeStoreHandler(method, input)));
}

const organizationKey = (organizationId: string) =>
  createHash("sha256").update(organizationId).digest("hex").slice(0, 32);

const migrationsFolder = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "database-migrations")
    : path.join(process.env.APP_ROOT, "..", "..", "packages", "db", "migrations", "local");

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

const dataDirectory = (target: WorkspaceTarget) =>
  target._tag === "Locked"
    ? path.join(app.getPath("userData"), "locked", "data")
    : path.join(
        app.getPath("userData"),
        "organizations",
        organizationKey(target.organizationId),
        "data",
      );

const workspaceStores: WorkspaceStoreAdapter = {
  open: async (target) => {
    const dataDir = dataDirectory(target);
    const baseConfig = {
      dataDir,
      migrationsFolder: migrationsFolder(),
      clientPlatform: "desktop" as const,
      clientVersion: app.getVersion(),
      resyncIntervalMillis: DESKTOP_SYNC_POLL_INTERVAL_MS,
    };
    const persistenceConfig =
      target._tag === "Authenticated"
        ? {
            ...baseConfig,
            syncTransport: {
              openLive: openDesktopSyncSocket({
                baseUrl: API_BASE_URL,
                organizationId: target.organizationId,
                deviceId: target.deviceId,
                getAccessToken: () => authBroker.accessToken,
                ensureFreshAccess: () => authBroker.ensureFreshAccess().then(() => undefined),
                electronOrigin: `${ELECTRON_PROTOCOL}://app`,
              }),
            },
            workspace: {
              organizationId: target.organizationId,
              userId: target.userId,
              deviceId: target.deviceId,
            },
          }
        : baseConfig;
    await mkdir(path.dirname(dataDir), { recursive: true });
    const runtime = ManagedRuntime.make(persistenceLayer(persistenceConfig));
    try {
      await runtime.runPromise(OfflineStore.pipe(Effect.asVoid));
    } catch (cause) {
      await runtime.dispose();
      throw cause;
    }
    return {
      run: (effect) => runtime.runPromise(effect),
      sync: () => runtime.runPromise(withStore((store) => store.sync)),
      onSyncStatusChange: (listener) =>
        runtime.runCallback(
          withStore((store) =>
            store.syncStatusChanges.pipe(
              Stream.runForEach((status) => Effect.sync(() => listener(status))),
            ),
          ),
        ),
      dispose: () => runtime.dispose(),
    };
  },
};

const makeWorkspace = (deviceId: string) =>
  new AuthenticatedWorkspace({
    auth: authBroker,
    stores: workspaceStores,
    deviceId,
    events: {
      publishSnapshot: (snapshot) => win?.webContents.send("auth:session-changed", snapshot),
      publishSyncStatus: (status) => win?.webContents.send(STORE_SYNC_STATUS_CHANNEL, status),
    },
  });

const currentWorkspace = () => {
  if (!workspace) throw new Error("Workspace isn't ready yet.");
  return workspace;
};

async function initializeWorkspace(deviceId: string) {
  workspace = makeWorkspace(deviceId);
  return workspace.initialize();
}

async function disposeWorkspace() {
  const current = workspace;
  workspace = undefined;
  if (current) await current.dispose();
}

const AuthTokens = Schema.NullOr(TokenSet);
const InvoiceUpload = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.String,
      bytes: Schema.instanceOf(ArrayBuffer),
    }),
  ),
});
const ThemeSource = Schema.Literals(["dark", "light", "system"]);

function registerAuthIpc() {
  ipcMain.handle("auth:get-session", () => currentWorkspace().snapshot);
  ipcMain.handle("auth:adopt-session", async (_event, input) => {
    const tokens = input === undefined ? null : Schema.decodeUnknownSync(AuthTokens)(input);
    return currentWorkspace().execute({ _tag: "AdoptSession", tokens });
  });
  ipcMain.handle("auth:renew-session", () => currentWorkspace().execute({ _tag: "RenewSession" }));
  ipcMain.handle("auth:sign-out", () => currentWorkspace().execute({ _tag: "SignOut" }));
  ipcMain.handle("auth:organization", () =>
    fetchOrganizationRoster((pathname, init) => currentWorkspace().authRequest(pathname, init)),
  );
  ipcMain.handle("auth:organize", async (_event, input) => {
    const command = Schema.decodeUnknownSync(OrganizationCommand)(input);
    return organizeOrganization(
      (pathname, init) => currentWorkspace().authRequest(pathname, init),
      command,
    );
  });
  ipcMain.handle("auth:open-external", async (_event, input) => {
    const url = Schema.decodeUnknownSync(Schema.String)(input);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") {
      throw new Error("Only Google authorization URLs can be opened.");
    }
    await shell.openExternal(parsed.href);
  });
}

function registerServerIpc() {
  ipcMain.handle("server:uploads", async (_event, input) => {
    const upload = Schema.decodeUnknownSync(InvoiceUpload)(input);
    const body = new FormData();
    for (const file of upload.files) {
      const inferredType = file.name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "text/csv";
      body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
    }
    const raw = await currentWorkspace().request("/api/uploads", { method: "POST", body });
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
      preload: path.join(__dirname, "preload.mjs"),
      backgroundThrottling: true,
      contextIsolation: true,
      devTools: !app.isPackaged,
      enableWebSQL: false,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setIcon(appIconPath());
  app.dock?.setIcon(appIconPath());

  win.once("ready-to-show", () => win?.show());

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter(
      (value): value is string => Boolean(value),
    );
    if (!allowed.some((origin) => url.startsWith(origin))) event.preventDefault();
  });

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

ipcMain.on("theme:set-source", (_event, input) => {
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

app.on("before-quit", () => {
  void disposeWorkspace();
  void disposeUpdater?.();
});

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

const publishOAuthCallback = (url: string) => {
  if (url.startsWith(`${ELECTRON_PROTOCOL}://auth/callback`)) {
    win?.webContents.send("auth:oauth-callback", url);
  }
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
  const deviceId = await loadDeviceId();
  await initializeWorkspace(deviceId);
  registerStoreIpc();
  registerAuthIpc();
  registerServerIpc();
  disposeUpdater = await setupUpdater(() => win);
  createWindow();
});
