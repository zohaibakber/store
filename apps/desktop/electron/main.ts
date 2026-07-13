import {
  CreateBatchInput,
  CreateInvoiceInput,
  CreateProductInput,
  InvoiceIdInput,
  ProductIdInput,
  type SyncResponse,
  UpdateProductInput,
} from "@store/contracts";
import {
  OfflineStore,
  PersistenceError,
  SyncTransportError,
  layer as persistenceLayer,
  program,
} from "@store/persistence";
import { app, BrowserWindow, ipcMain } from "electron";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AuthBroker, type AuthSnapshot } from "./auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
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
  } catch {
    // file does not exist
  }
}

let win: BrowserWindow | null;
let runtime: ManagedRuntime.ManagedRuntime<OfflineStore, PersistenceError> | undefined;
let activeOrganizationId: string | null = null;
let deviceId = "local";
const authBroker = new AuthBroker(
  process.env["STORE_API_URL"] ?? process.env["VITE_API_URL"] ?? "http://localhost:8787",
  process.env["ELECTRON_PROTOCOL"] ?? "com.tabaaq.desktop",
);
authBroker.setupMain();

const runStore = <A, E>(effect: Effect.Effect<A, E, OfflineStore>) => {
  if (!runtime) return Promise.reject(new Error("The local store is not ready"));
  return runtime.runPromise(effect).catch((cause: unknown) => {
    const message =
      typeof cause === "object" && cause !== null && "message" in cause
        ? String(cause.message)
        : String(cause);
    throw new Error(message);
  });
};

function registerStoreIpc() {
  ipcMain.handle("store:categories:list", () => runStore(program.listCategories));
  ipcMain.handle("store:products:list", () => runStore(program.listProducts));
  ipcMain.handle("store:products:get", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(ProductIdInput)(input).pipe(
        Effect.flatMap(({ id }) => program.getProduct(id)),
      ),
    ),
  );
  ipcMain.handle("store:products:create", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(CreateProductInput)(input).pipe(
        Effect.flatMap(program.createProduct),
      ),
    ),
  );
  ipcMain.handle("store:products:update", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(UpdateProductInput)(input).pipe(
        Effect.flatMap(program.updateProduct),
      ),
    ),
  );
  ipcMain.handle("store:products:delete", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(ProductIdInput)(input).pipe(
        Effect.flatMap(({ id }) => program.deleteProduct(id)),
      ),
    ),
  );
  ipcMain.handle("store:batches:create", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(CreateBatchInput)(input).pipe(Effect.flatMap(program.createBatch)),
    ),
  );
  ipcMain.handle("store:stock-movements:list", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(ProductIdInput)(input).pipe(
        Effect.flatMap(({ id }) => program.listStockMovements(id)),
      ),
    ),
  );
  ipcMain.handle("store:invoices:list", () => runStore(program.listInvoices));
  ipcMain.handle("store:invoices:get", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(InvoiceIdInput)(input).pipe(
        Effect.flatMap(({ id }) => program.getInvoice(id)),
      ),
    ),
  );
  ipcMain.handle("store:invoices:create", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(CreateInvoiceInput)(input).pipe(
        Effect.flatMap(program.createInvoice),
      ),
    ),
  );
  ipcMain.handle("store:sync:status", () => runStore(program.getSyncStatus));
  ipcMain.handle("store:sync:run", () => runStore(program.sync));
}

const organizationKey = (organizationId: string) =>
  createHash("sha256").update(organizationId).digest("hex").slice(0, 32);

const migrationsFolder = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "database-migrations")
    : path.join(process.env.APP_ROOT, "..", "..", "packages", "db", "migrations");

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

async function disposeRuntime() {
  const current = runtime;
  runtime = undefined;
  activeOrganizationId = null;
  if (current) await current.dispose();
}

async function activateLockedRuntime() {
  await disposeRuntime();
  const dataDir = path.join(app.getPath("userData"), "locked", "pglite");
  await mkdir(path.dirname(dataDir), { recursive: true });
  runtime = ManagedRuntime.make(
    persistenceLayer({
      dataDir,
      migrationsFolder: migrationsFolder(),
    }),
  );
}

async function activateOrganization(organizationId: string) {
  if (activeOrganizationId === organizationId && runtime) return;
  await disposeRuntime();
  const key = organizationKey(organizationId);
  const dataDir = path.join(app.getPath("userData"), "organizations", key, "pglite");
  await mkdir(path.dirname(dataDir), { recursive: true });
  runtime = ManagedRuntime.make(
    persistenceLayer({
      dataDir,
      migrationsFolder: migrationsFolder(),
      syncTransport: {
        exchange: (request) =>
          Effect.tryPromise({
            try: () =>
              authBroker.apiRequest<SyncResponse>("/api/sync", {
                method: "POST",
                body: request,
              }),
            catch: (cause) =>
              new SyncTransportError({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          }),
      },
      mutationContext: () => ({
        organizationId,
        userId: authBroker.snapshot.user?.id ?? "offline",
        deviceId,
      }),
    }),
  );
  activeOrganizationId = organizationId;
}

async function applyAuthSnapshot(snapshot: AuthSnapshot) {
  if (snapshot.status === "authenticated" && snapshot.activeOrganization)
    await activateOrganization(snapshot.activeOrganization.id);
  else await activateLockedRuntime();
  win?.webContents.send("auth:session-changed", snapshot);
  return snapshot;
}

const inputString = (input: unknown, key: string, maximum = 160) => {
  if (!input || typeof input !== "object") throw new Error("Invalid authentication request.");
  const value = Reflect.get(input, key);
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error(`Invalid ${key}.`);
  return value.trim();
};

function registerAuthIpc() {
  ipcMain.handle("auth:get-session", () => authBroker.snapshot);
  ipcMain.handle("auth:sign-in", async (_event, input: unknown) =>
    applyAuthSnapshot(
      await authBroker.signIn({
        email: inputString(input, "email"),
        password: inputString(input, "password", 256),
      }),
    ),
  );
  ipcMain.handle("auth:sign-up", async (_event, input: unknown) =>
    applyAuthSnapshot(
      await authBroker.signUp({
        name: inputString(input, "name"),
        email: inputString(input, "email"),
        password: inputString(input, "password", 256),
      }),
    ),
  );
  ipcMain.handle("auth:sign-out", async () => {
    await authBroker.signOut();
    await applyAuthSnapshot(authBroker.snapshot);
  });
  ipcMain.handle("auth:organization:switch", async (_event, input: unknown) =>
    applyAuthSnapshot(
      await authBroker.switchOrganization({ organizationId: inputString(input, "organizationId") }),
    ),
  );
  ipcMain.handle("auth:organization:create", async (_event, input: unknown) =>
    applyAuthSnapshot(await authBroker.createOrganization({ name: inputString(input, "name") })),
  );
}

function registerServerIpc() {
  ipcMain.handle("server:models", () => authBroker.apiRequest("/api/models"));
  ipcMain.handle(
    "server:uploads",
    async (
      _event,
      input: {
        model: string;
        files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
      },
    ) => {
      if (!input || !Array.isArray(input.files) || typeof input.model !== "string")
        throw new Error("Invalid invoice upload request.");
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
      body.append("model", input.model);
      return authBroker.apiRequest("/api/uploads", { method: "POST", body });
    },
  );
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const expected = VITE_DEV_SERVER_URL ?? `file://${RENDERER_DIST}`;
    if (!url.startsWith(expected)) event.preventDefault();
  });

  win.on("enter-full-screen", () => {
    win?.webContents.send("window-controls:full-screen-changed", true);
  });

  win.on("leave-full-screen", () => {
    win?.webContents.send("window-controls:full-screen-changed", false);
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    void win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  void disposeRuntime();
});

void app.whenReady().then(async () => {
  deviceId = await loadDeviceId();
  const snapshot = await authBroker.initialize();
  registerStoreIpc();
  registerAuthIpc();
  registerServerIpc();
  if (snapshot.status === "authenticated" && snapshot.activeOrganization)
    await activateOrganization(snapshot.activeOrganization.id);
  else await activateLockedRuntime();
  createWindow();
});
