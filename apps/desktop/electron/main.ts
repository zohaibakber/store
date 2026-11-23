// Must stay the first import: parsers created before it run on the interpreter.
import "effect/schema/SchemaJITCompiler/enable";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { ELECTRON_PROTOCOL } from "@store/auth/security";
import { deviceLabelOf } from "@store/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import { app, Menu } from "electron";

import { makeDesktopContentSecurityPolicy } from "./content-security-policy";
import { mainProgram } from "./main-program";
import { oauthCallbackRedirectUri } from "./oauth-callback";
import { desktopRendererOrigin, registerDesktopSchemePrivileges } from "./protocol";
import { initDesktopSentry, reportDesktopError } from "./sentry";

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

const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "logo.png")
  : path.join(process.env.APP_ROOT, "assets", "dev", "logo-dev.png");

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

// Both must run before the app is ready, so they stay outside the program.
registerDesktopSchemePrivileges(ELECTRON_PROTOCOL);
Menu.setApplicationMenu(null);

const hostDeviceLabel = () => {
  const [name = ""] = hostname().split(".");
  return name.includes("@") ? undefined : deviceLabelOf(name);
};

const allowedRendererOrigins = () =>
  [desktopRendererOrigin(ELECTRON_PROTOCOL), VITE_DEV_SERVER_URL].filter((value): value is string =>
    Boolean(value),
  );

const program = mainProgram({
  apiBaseUrl: __API_URL__,
  authBaseUrl: __AUTH_URL__,
  packaged: app.isPackaged,
  workerPath: path.join(MAIN_DIST, "replica-worker.js"),
  deviceLabel: hostDeviceLabel(),
  oauthRedirectUri: oauthCallbackRedirectUri(ELECTRON_PROTOCOL),
  scheme: ELECTRON_PROTOCOL,
  argv: process.argv,
  rendererRoot: RENDERER_DIST,
  developmentServerUrl: VITE_DEV_SERVER_URL,
  contentSecurityPolicy: makeDesktopContentSecurityPolicy({
    scheme: ELECTRON_PROTOCOL,
    apiOrigin: new URL(__API_URL__).origin,
    development: Boolean(VITE_DEV_SERVER_URL),
  }),
  allowedOrigins: allowedRendererOrigins,
  preloadPath: path.join(__dirname, "preload.cjs"),
  iconPath: appIconPath,
});

// The one edge of the main process. A second instance hands its argv to the
// first and quits. Otherwise the program runs until a quit request closes its
// scope, and only then does the app quit.
if (app.requestSingleInstanceLock()) {
  NodeRuntime.runMain(
    program.pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.sync(() => reportDesktopError(Cause.squash(cause), { op: "desktop-main" })),
      ),
    ),
    {
      disableErrorReporting: true,
      teardown: (exit, onExit) =>
        Runtime.defaultTeardown(exit, (code) => {
          process.exitCode = code;
          app.quit();
          onExit(code);
        }),
    },
  );
} else {
  app.quit();
}
