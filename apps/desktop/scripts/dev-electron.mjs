import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import { createRequire } from "node:module";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = NodePath.resolve(NodePath.dirname(fileURLToPath(import.meta.url)), "..");
const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = ["dist-electron/main.js", "dist-electron/preload.cjs"];
const watchedFiles = new Set(["main.js", "preload.cjs"]);
const electronPath = createRequire(import.meta.url)("electron");
const restartDebounceMs = 120;
const shutdownTimeoutMs = 1_500;

let currentApp;
let restartTimer;
let shuttingDown = false;
let restartQueue = Promise.resolve();

const resourcesReady = () =>
  requiredFiles.every((file) => NodeFS.existsSync(NodePath.join(desktopDir, file)));

const serverReady = () =>
  new Promise((resolve) => {
    const socket = NodeNet.createConnection({ host: devServer.hostname, port });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });

const waitUntilReady = async () => {
  while (!shuttingDown && (!resourcesReady() || !(await serverReady()))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const startApp = () => {
  if (shuttingDown || currentApp) return;
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  currentApp = NodeChildProcess.spawn(electronPath, [".", "--no-sandbox"], {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });
  currentApp.once("exit", () => {
    currentApp = undefined;
  });
};

const stopApp = async () => {
  const app = currentApp;
  if (!app) return;
  currentApp = undefined;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    app.once("exit", finish);
    app.kill("SIGTERM");
    setTimeout(() => {
      if (!settled) app.kill("SIGKILL");
      finish();
    }, shutdownTimeoutMs).unref();
  });
};

const scheduleRestart = () => {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    restartQueue = restartQueue.then(async () => {
      await stopApp();
      startApp();
    });
  }, restartDebounceMs);
};

const shutdown = async (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  await stopApp();
  process.exit(exitCode);
};

await waitUntilReady();
if (!shuttingDown) {
  NodeFS.watch(
    NodePath.join(desktopDir, "dist-electron"),
    { encoding: "utf8" },
    (_event, filename) => {
      if (filename !== null && watchedFiles.has(filename)) scheduleRestart();
    },
  );
  startApp();
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.once("SIGHUP", () => void shutdown(129));
