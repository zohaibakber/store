import { CreateNoteInput, DeleteNoteInput, UpdateNoteInput } from "@store/contracts";
import {
  OfflineStore,
  PersistenceError,
  layer as persistenceLayer,
  program,
} from "@store/persistence";
import { app, BrowserWindow, ipcMain } from "electron";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

// Turbo runs tasks with a filtered environment, so Turso credentials are read
// from .env files instead. Earlier files and pre-set shell variables win.
const envFiles = [
  path.join(process.env.APP_ROOT, ".env"),
  path.join(process.env.APP_ROOT, "..", "..", ".env"),
  path.join(process.env.APP_ROOT, "..", "..", "packages", "persistence", ".env"),
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
  ipcMain.handle("store:notes:list", () => runStore(program.listNotes));
  ipcMain.handle("store:notes:create", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(CreateNoteInput)(input).pipe(Effect.flatMap(program.createNote)),
    ),
  );
  ipcMain.handle("store:notes:update", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(UpdateNoteInput)(input).pipe(Effect.flatMap(program.updateNote)),
    ),
  );
  ipcMain.handle("store:notes:delete", (_event, input: unknown) =>
    runStore(
      Schema.decodeUnknownEffect(DeleteNoteInput)(input).pipe(
        Effect.flatMap(({ id }) => program.deleteNote(id)),
      ),
    ),
  );
  ipcMain.handle("store:sync:status", () => runStore(program.getSyncStatus));
  ipcMain.handle("store:sync:run", () => runStore(program.sync));
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
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
  if (runtime) void runtime.dispose();
});

void app.whenReady().then(() => {
  const databasePath = path.join(app.getPath("userData"), "offline-store.db");
  runtime = ManagedRuntime.make(
    persistenceLayer({
      path: databasePath,
      syncUrl: process.env["TURSO_SYNC_URL"] ?? process.env["TURSO_DATABASE_URL"],
      authToken: process.env["TURSO_AUTH_TOKEN"],
    }),
  );
  registerStoreIpc();
  createWindow();
});
