import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  type MessagePortMain,
  nativeTheme,
  screen,
  session,
  type WebContents,
} from "electron";

import { SHELL_PORT_REQUEST_CHANNEL } from "../src/host/shell-port-channels";
import { DesktopAuth } from "./auth";
import { listen, reported } from "./electron-events";
import { layerDesktopHost, type DesktopHostConfig } from "./host";
import { MainWindow } from "./main-window";
import { isNewSaleAccelerator } from "./new-sale-accelerator";
import { isOAuthCallbackUrl } from "./oauth-callback";
import { desktopRendererUrl, registerDesktopProtocolHandler } from "./protocol";
import { lockDownRenderer } from "./renderer-lockdown";
import { ReplicaHost } from "./replica-host";
import { ShellEvents } from "./shell-events";
import { makeShellPort } from "./shell-port";
import { ShellServer } from "./shell-server";
import { readThemeSource } from "./theme-source";

export interface MainProgramConfig extends DesktopHostConfig {
  readonly scheme: string;
  readonly argv: ReadonlyArray<string>;
  readonly rendererRoot: string;
  readonly developmentServerUrl: string | undefined;
  readonly contentSecurityPolicy: string;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly preloadPath: string;
  readonly iconPath: string;
}

const WINDOW_LIGHT_BACKGROUND = "#ffffff";
const WINDOW_DARK_BACKGROUND = "#161616";

const windowBackground = () =>
  nativeTheme.shouldUseDarkColors ? WINDOW_DARK_BACKGROUND : WINDOW_LIGHT_BACKGROUND;

// Small and square screens (800x600, 1024x768, 1280x1024) have no room to spare,
// so the window opens maximized there; larger screens get a comfortable size.
const initialWindowBounds = () => {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1440, area.width),
    height: Math.min(900, area.height),
    minWidth: Math.min(800, area.width),
    minHeight: Math.min(560, area.height),
    maximize: area.width < 1440 || area.height < 900,
  };
};

/**
 * Before the app is ready: OAuth callbacks from argv, `open-url` and a second
 * instance go straight onto the shell's queue, which buffers them until the
 * renderer reads it, and a quit request ends the program instead of the app.
 */
const watchApp = Effect.fn("Main.watchApp")(function* (
  config: MainProgramConfig,
  quitRequested: Deferred.Deferred<void>,
) {
  const events = yield* ShellEvents;
  const window = yield* MainWindow;
  const run = yield* FiberSet.makeRuntime<never>();
  const isCallback = (value: string) => value.startsWith(`${config.scheme}://`);
  const offerCallback = (url: string) => {
    if (isOAuthCallbackUrl(url, config.scheme)) Queue.offerUnsafe(events.oauthCallbacks, url);
  };

  const onOpenUrl = (event: Electron.Event, url: string) => {
    event.preventDefault();
    offerCallback(url);
  };
  yield* listen(
    () => app.on("open-url", onOpenUrl),
    () => app.removeListener("open-url", onOpenUrl),
  );

  const onSecondInstance = (_event: Electron.Event, argv: Array<string>) => {
    const callback = argv.find(isCallback);
    if (callback) offerCallback(callback);
    run(
      window.use((current) => {
        if (current.isMinimized()) current.restore();
        current.focus();
      }),
    );
  };
  yield* listen(
    () => app.on("second-instance", onSecondInstance),
    () => app.removeListener("second-instance", onSecondInstance),
  );

  // Electron waits for nothing after `before-quit`, so the first one is held
  // back while the program closes its scope. The listener goes with that scope,
  // and the teardown's own `app.quit()` then passes straight through.
  const onBeforeQuit = (event: Electron.Event) => {
    event.preventDefault();
    Deferred.doneUnsafe(quitRequested, Exit.void);
  };
  yield* listen(
    () => app.on("before-quit", onBeforeQuit),
    () => app.removeListener("before-quit", onBeforeQuit),
  );

  const onAllClosed = () => {
    if (process.platform !== "darwin") app.quit();
  };
  yield* listen(
    () => app.on("window-all-closed", onAllClosed),
    () => app.removeListener("window-all-closed", onAllClosed),
  );

  const initial = config.argv.find(isCallback);
  if (initial) offerCallback(initial);
});

/**
 * Opens the main window and ties its listeners and shell port to a scope that
 * closes with the window.
 */
const openMainWindow = Effect.fn("Main.openWindow")(function* (config: MainProgramConfig) {
  const mainWindow = yield* MainWindow;
  const events = yield* ShellEvents;
  const replicas = yield* ReplicaHost;
  const server = yield* ShellServer;
  const programScope = yield* Effect.scope;
  const closeWindowScope = yield* FiberSet.makeRuntime<never>();
  const windowScope = yield* Scope.fork(programScope);
  const run = yield* FiberSet.makeRuntime<never>().pipe(Scope.provide(windowScope));

  const { maximize, ...bounds } = initialWindowBounds();
  const window = new BrowserWindow({
    ...bounds,
    center: true,
    icon: config.iconPath,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    titleBarStyle: "hidden",
    webPreferences: {
      preload: config.preloadPath,
      backgroundThrottling: true,
      contextIsolation: true,
      devTools: !config.packaged,
      enableWebSQL: false,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });
  window.setIcon(config.iconPath);
  app.dock?.setIcon(config.iconPath);
  yield* mainWindow.set(Option.some(window));

  const publishForeground = (visible: boolean) => () =>
    run(replicas.setForeground(visible).pipe(reported("replica-foreground")));
  const publishMaximized = () => {
    if (!window.isDestroyed()) PubSub.publishUnsafe(events.maximized, window.isMaximized());
  };

  const shellPort = makeShellPort<WebContents, MessagePortMain>({
    allowedOrigins: config.allowedOrigins,
    mainWindowContentsId: () => (window.isDestroyed() ? undefined : window.webContents.id),
    channel: () => new MessageChannelMain(),
    serve: (sender, port) => run(server.serve(sender, port).pipe(reported("shell-port-serve"))),
    release: (senderId) => run(server.release(senderId).pipe(reported("shell-port-release"))),
  });
  shellPort.attach(window.webContents);
  const onShellPortRequest = (event: Electron.IpcMainEvent) => {
    shellPort.request(event);
  };
  yield* listen(
    () => ipcMain.on(SHELL_PORT_REQUEST_CHANNEL, onShellPortRequest),
    () => ipcMain.removeListener(SHELL_PORT_REQUEST_CHANNEL, onShellPortRequest),
  ).pipe(Scope.provide(windowScope));

  const onThemeUpdated = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(windowBackground());
  };
  yield* listen(
    () => nativeTheme.on("updated", onThemeUpdated),
    () => nativeTheme.removeListener("updated", onThemeUpdated),
  ).pipe(Scope.provide(windowScope));

  window.once("ready-to-show", () => {
    if (maximize) window.maximize();
    window.show();
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "debug" || event.level === "info") return;
    const location = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : "";
    console.error(`[renderer ${event.level}] ${event.message}${location}`);
  });
  window.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive.");
  });
  window.on("closed", () => {
    closeWindowScope(
      mainWindow
        .set(Option.none())
        .pipe(Effect.andThen(Scope.close(windowScope, Exit.void)), reported("window-closed")),
    );
  });
  window.on("maximize", publishMaximized);
  window.on("unmaximize", publishMaximized);
  window.on("blur", publishForeground(false));
  window.on("minimize", publishForeground(false));
  window.on("hide", publishForeground(false));
  window.on("focus", publishForeground(true));
  window.on("restore", publishForeground(true));
  window.on("show", publishForeground(true));
  publishMaximized();

  void window.loadURL(desktopRendererUrl(config.scheme));
});

/**
 * After the app is ready: the renderer protocol, the lockdown, the theme, the
 * window, the shortcuts and the session restore, then the wait for a quit.
 */
const runReady = Effect.fn("Main.ready")(function* (
  config: MainProgramConfig,
  quitRequested: Deferred.Deferred<void>,
) {
  const events = yield* ShellEvents;
  const mainWindow = yield* MainWindow;
  const run = yield* FiberSet.makeRuntime<
    MainWindow | ReplicaHost | ShellEvents | ShellServer | Scope.Scope
  >();

  app.setAsDefaultProtocolClient(config.scheme);
  registerDesktopProtocolHandler({
    scheme: config.scheme,
    rendererRoot: config.rendererRoot,
    developmentServerUrl: config.developmentServerUrl,
    contentSecurityPolicy: config.contentSecurityPolicy,
  });
  lockDownRenderer({
    session: session.defaultSession,
    allowedOrigins: config.allowedOrigins,
    contentSecurityPolicy: config.contentSecurityPolicy,
  });

  const onContentsCreated = (_event: Electron.Event, contents: WebContents) => {
    contents.on("before-input-event", (event, input) => {
      if (!isNewSaleAccelerator(input)) return;
      event.preventDefault();
      run(
        Effect.flatMap(mainWindow.current, (window) =>
          Option.isSome(window) && window.value.webContents.id === contents.id
            ? PubSub.publish(events.newSale, undefined)
            : Effect.void,
        ),
      );
    });
  };
  yield* listen(
    () => app.on("web-contents-created", onContentsCreated),
    () => app.removeListener("web-contents-created", onContentsCreated),
  );

  nativeTheme.themeSource = yield* readThemeSource(app.getPath("userData"));
  yield* openMainWindow(config);

  const onActivate = () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      run(openMainWindow(config).pipe(reported("window-open")));
    }
  };
  yield* listen(
    () => app.on("activate", onActivate),
    () => app.removeListener("activate", onActivate),
  );

  yield* Effect.forkScoped(DesktopAuth.use((auth) => auth.initialize));
  yield* Deferred.await(quitRequested);
});

/**
 * The whole main process as one program: everything it opens lives in its
 * scope, and the first quit request closes that scope before the app exits.
 */
export const mainProgram = (config: MainProgramConfig) =>
  Effect.gen(function* () {
    const quitRequested = yield* Deferred.make<void>();
    yield* watchApp(config, quitRequested);
    yield* Effect.promise(() => app.whenReady());
    yield* runReady(config, quitRequested).pipe(Effect.provide(layerDesktopHost(config)));
  }).pipe(
    Effect.scoped,
    Effect.provide([ShellEvents.layer, MainWindow.layer]),
    Effect.withSpan("Main.program"),
  );
