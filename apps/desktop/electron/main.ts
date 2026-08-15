import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { DEFAULT_ELECTRON_PROTOCOL, fallbackIfBlank } from "@store/auth/security";
import { encodeStoreError, InvoiceExtraction } from "@store/contracts";
import { OfflineStore, PersistenceError, layer as persistenceLayer } from "@store/persistence";
import {
  AuthenticatedWorkspace,
  storeHandlers,
  withStoreEffect,
  type StoreMethod,
  type WorkspaceStoreAdapter,
  type WorkspaceTarget,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { app, BrowserWindow, ipcMain, nativeTheme, session } from "electron";

import { AuthBroker } from "./auth";
import {
  clerkFrontendApiHostname,
  desktopRendererOrigin,
  desktopRendererUrl,
  makeDesktopContentSecurityPolicy,
  registerDesktopProtocolHandler,
  registerDesktopSchemePrivileges,
} from "./protocol";
import { STORE_CHANNELS, STORE_SYNC_STATUS_CHANNEL } from "./store-channels";
import { setupUpdater } from "./updater";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
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
  // nativeImage (which BrowserWindow's `icon` option uses under the hood)
  // reads the real filesystem and can't see into app.asar, so packaged
  // builds must load the icon from extraResources instead of the bundled
  // renderer assets.
  return app.isPackaged
    ? path.join(process.resourcesPath, "logo.png")
    : path.join(process.env.VITE_PUBLIC, "logo.png");
}
// Packaged apps ship no .env, so the API URL is baked in at build time via
// `import.meta.env` (dot access on purpose — Vite inlines it); the bracket
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
const CLERK_PUBLISHABLE_KEY = fallbackIfBlank(
  process.env["VITE_CLERK_PUBLISHABLE_KEY"] ?? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  "",
);

// Local commits signal the sync engine immediately. This slower safety poll is
// only a fallback for remote changes, so running it every few seconds wastes a
// network round-trip and SQLite work while the app is idle.
const DESKTOP_SYNC_POLL_INTERVAL_MS = 60_000;

registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
const clerkBridge = createClerkBridge({
  storage: storage(),
  passkeys: true,
  renderer: { scheme: ELECTRON_PROTOCOL, host: "app" },
  userAgent: `Tabaaq/${app.getVersion()}`,
});

const authBroker = new AuthBroker(API_BASE_URL, `${ELECTRON_PROTOCOL}://app`);

const rendererCsp = makeDesktopContentSecurityPolicy({
  scheme: ELECTRON_PROTOCOL,
  apiOrigin: new URL(API_BASE_URL).origin,
  clerkFrontendApiHostname: clerkFrontendApiHostname(CLERK_PUBLISHABLE_KEY),
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

const errorMessage = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : String(cause);

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
          message: "The local store is not ready",
        }),
      ),
    };
  try {
    return { ok: true, value: await workspace.runStore(effect) };
  } catch (cause) {
    return { ok: false, error: encodeStoreErrorSafely(cause) };
  }
};

type OfflineStoreShape = Effect.Success<typeof OfflineStore>;
const withStore = withStoreEffect as <A, E>(
  f: (store: OfflineStoreShape) => Effect.Effect<A, E>,
) => Effect.Effect<A, E, OfflineStore>;

function registerStoreIpc() {
  for (const [method, channel] of Object.entries(STORE_CHANNELS))
    ipcMain.handle(channel, (_event, input: unknown) =>
      runStore(storeHandlers[method as StoreMethod](input)),
    );
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
    await mkdir(path.dirname(dataDir), { recursive: true });
    const runtime = ManagedRuntime.make(
      persistenceLayer({
        dataDir,
        migrationsFolder: migrationsFolder(),
        clientPlatform: "desktop",
        clientVersion: app.getVersion(),
        resyncIntervalMillis: DESKTOP_SYNC_POLL_INTERVAL_MS,
        ...(target._tag === "Authenticated"
          ? {
              syncTransport: {
                exchange: target.exchange,
              },
              workspace: {
                organizationId: target.organizationId,
                userId: target.userId,
                deviceId: target.deviceId,
              },
            }
          : {}),
      }),
    );
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
  if (!workspace) throw new Error("The authenticated workspace is not ready.");
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

const inputString = (input: unknown, key: string, maximum = 160) => {
  if (!input || typeof input !== "object") throw new Error("Invalid authentication request.");
  const value = Reflect.get(input, key);
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error(`Invalid ${key}.`);
  return value.trim();
};

function registerAuthIpc() {
  ipcMain.handle("auth:get-session", () => currentWorkspace().snapshot);
  ipcMain.handle("auth:adopt-session", async (_event, token: unknown) =>
    currentWorkspace().execute({
      _tag: "AdoptSession",
      token: token === null || token === undefined ? null : inputString({ token }, "token", 16_384),
    }),
  );
  ipcMain.handle("auth:sign-out", () => currentWorkspace().execute({ _tag: "SignOut" }));
}

function registerServerIpc() {
  ipcMain.handle(
    "server:uploads",
    async (
      _event,
      input: {
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      },
    ) => {
      if (!input || !Array.isArray(input.files)) throw new Error("Invalid invoice upload request.");
      const body = new FormData();
      for (const file of input.files) {
        if (
          !file ||
          typeof file.name !== "string" ||
          typeof file.type !== "string" ||
          !(file.bytes instanceof ArrayBuffer)
        )
          throw new Error("Invalid invoice attachment.");
        const inferredType = file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/csv";
        body.append(
          "files",
          new File([file.bytes], file.name, { type: file.type || inferredType }),
        );
      }
      const raw = await currentWorkspace().request("/api/uploads", { method: "POST", body });
      return await Effect.runPromise(
        Schema.decodeUnknownEffect(InvoiceExtraction)(raw).pipe(
          Effect.mapError(
            () => new Error("The invoice analysis response was not in the expected format."),
          ),
        ),
      );
    },
  );
}

function createWindow() {
  win = new BrowserWindow({
    icon: appIconPath(),
    frame: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f5f5f4",
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

  win.once("ready-to-show", () => win?.show());

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter(
      (value): value is string => Boolean(value),
    );
    if (!allowed.some((origin) => url.startsWith(origin))) event.preventDefault();
  });

  win.on("enter-full-screen", () => {
    win?.webContents.send("window-controls:full-screen-changed", true);
  });

  win.on("leave-full-screen", () => {
    win?.webContents.send("window-controls:full-screen-changed", false);
  });

  win.on("closed", () => {
    win = null;
  });

  void win.loadURL(desktopRendererUrl(ELECTRON_PROTOCOL));
}

ipcMain.on("window-controls:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window-controls:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }

  return window.isMaximized();
});

ipcMain.handle("window-controls:is-maximized", (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

ipcMain.handle("window-controls:is-full-screen", (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

ipcMain.on("window-controls:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
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
  clerkBridge.cleanup();
  void disposeWorkspace();
  void disposeUpdater?.();
});

void app.whenReady().then(async () => {
  if (!clerkBridge.isPrimaryInstance) {
    app.quit();
    return;
  }
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
