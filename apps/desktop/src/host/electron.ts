import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";

import type { ReplicaFileRefused } from "./file-refusal";
import { fileRefusalMessage } from "./file-refusal-copy";
import type { AppHost, AppUpdaterBridge } from "./index";
import { makeReplayChannel } from "./replay-channel";
import { SHELL_PORT_CHANNEL } from "./shell-port-channels";
import {
  ShellRpcs,
  type InventoryHttpConfig,
  type ReplicaIdentity,
  type ReplicaOpened,
} from "./shell-rpcs";

export type ShellPortBridge = { readonly connect: () => void };

export interface InventoryHttpBridge {
  readonly getConfig: () => Promise<InventoryHttpConfig>;
}

export type ReplicaWorkspaceBridge = {
  readonly open: (identity: ReplicaIdentity) => Promise<ReplicaOpened>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly retryRecovery: (workspaceToken: string) => Promise<void>;
};

declare global {
  interface Window {
    shellPort?: ShellPortBridge;
  }
}

class ShellClient extends Context.Service<
  ShellClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof ShellRpcs>, RpcClientError>
>()("@store/desktop/ShellClient") {}

type Client = ShellClient["Service"];

const shellPort = (source: Window, connect: () => void) =>
  Effect.callback<MessagePort>((resume) => {
    const onMessage = (event: MessageEvent) => {
      const [port] = event.ports;
      if (event.source !== source || event.data?.type !== SHELL_PORT_CHANNEL || !port) return;
      resume(Effect.succeed(port));
    };
    source.addEventListener("message", onMessage);
    connect();
    return Effect.sync(() => source.removeEventListener("message", onMessage));
  });

const layerShellClient = (source: Window, connect: () => void) =>
  Layer.effect(ShellClient, RpcClient.make(ShellRpcs)).pipe(
    Layer.provide(
      Layer.unwrap(
        shellPort(source, connect).pipe(
          Effect.map((port) =>
            RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
              Layer.provide(BrowserWorker.layer(() => port)),
            ),
          ),
        ),
      ),
    ),
  );

const refusedAsFailure = (refusal: ReplicaFileRefused) =>
  Effect.succeed({ _tag: "failed" as const, message: fileRefusalMessage(refusal) });

const once = (start: () => void) => {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    start();
  };
};

export const electronAppHost = (source: Window): AppHost => {
  const bridge = source.shellPort;
  if (!bridge) throw new Error("Desktop shell bridge is unavailable.");
  const runtime = ManagedRuntime.make(layerShellClient(source, bridge.connect));
  void runtime.runPromise(Effect.void);

  const call = <A, E>(use: (client: Client) => Effect.Effect<A, E>) =>
    runtime.runPromise(ShellClient.use(use));

  const fire = (use: (client: Client) => Effect.Effect<unknown, unknown>) => {
    runtime.runFork(ShellClient.use(use).pipe(Effect.ignore({ log: true })));
  };

  const listen = <A>(
    stream: (client: Client) => Stream.Stream<A, unknown>,
    onValue: (value: A) => void,
  ) => {
    const fiber = runtime.runFork(
      ShellClient.use((client) =>
        stream(client).pipe(Stream.runForEach((value) => Effect.sync(() => onValue(value)))),
      ).pipe(Effect.ignoreCause),
    );
    return () => fiber.interruptUnsafe();
  };

  const sessionReplay = makeReplayChannel<WorkspaceSnapshot>();
  const watchSession = once(() => {
    listen((client) => client.SessionChanges(), sessionReplay.publish);
  });
  const published = async (snapshot: Promise<WorkspaceSnapshot>) => {
    const settled = await snapshot;
    sessionReplay.publish(settled);
    return settled;
  };

  const oauthCallbackListeners = new Set<(url: string) => void>();
  let unclaimedOAuthCallback: string | null = null;
  const watchOAuthCallbacks = once(() => {
    listen(
      (client) => client.OAuthCallbacks(),
      (url) => {
        if (oauthCallbackListeners.size === 0) {
          unclaimedOAuthCallback = url;
          return;
        }
        for (const listener of oauthCallbackListeners) listener(url);
      },
    );
  });

  const windowMaximized = makeReplayChannel<boolean>();
  const watchWindowMaximized = once(() => {
    listen((client) => client.WindowMaximized(), windowMaximized.publish);
  });

  const updater: AppUpdaterBridge | undefined = import.meta.env.PROD
    ? {
        check: () => call((client) => client.UpdaterCheck()),
        install: () => fire((client) => client.UpdaterInstall()),
        onEvent: (listener) => listen((client) => client.UpdaterEvents(), listener),
      }
    : undefined;

  const host: AppHost = {
    auth: {
      getSession: () => published(call((client) => client.AuthSession())),
      renewSession: () => published(call((client) => client.AuthRenew())),
      signOut: () => call((client) => client.AuthSignOut()),
      organizationRoster: () => call((client) => client.AuthOrganization()),
      organize: (command) => call((client) => client.AuthOrganize({ command })),
      onSessionChange: (listener) => {
        watchSession();
        return sessionReplay.subscribe(listener);
      },
    },
    signIn: {
      identify: (input) => call((client) => client.AuthIdentify(input)),
      authenticate: (credentials) =>
        published(call((client) => client.AuthAuthenticate({ credentials }))),
      beginGoogle: () => call((client) => client.AuthBeginGoogle()),
      completeGoogle: async (callbackUrl) => {
        const snapshot = await call((client) => client.AuthCompleteGoogle({ callbackUrl }));
        if (snapshot !== null) sessionReplay.publish(snapshot);
        return snapshot;
      },
      onOAuthCallback: (callback) => {
        oauthCallbackListeners.add(callback);
        const unclaimed = unclaimedOAuthCallback;
        unclaimedOAuthCallback = null;
        if (unclaimed) callback(unclaimed);
        watchOAuthCallbacks();
        return () => {
          oauthCallbackListeners.delete(callback);
        };
      },
    },
    analyseInvoices: (files) => call((client) => client.AnalyseInvoices({ files })),
    searchGlobalProducts: (query) => call((client) => client.SearchGlobalProducts({ query })),
    shell: {
      onNewSale: (callback) =>
        listen(
          (client) => client.NewSale(),
          () => callback(),
        ),
      window: {
        minimize: () => fire((client) => client.WindowMinimize()),
        toggleMaximize: () => fire((client) => client.WindowToggleMaximize()),
        close: () => fire((client) => client.WindowClose()),
        isMaximized: () => windowMaximized.current() ?? false,
        onMaximizedChange: (listener) => {
          watchWindowMaximized();
          return windowMaximized.subscribe(() => listener());
        },
      },
    },
    theme: { setSource: (source) => fire((client) => client.ThemeSetSource({ source })) },
    backup: {
      backUp: () =>
        call((client) =>
          client.BackUp().pipe(Effect.catchTag("ReplicaFileRefused", refusedAsFailure)),
        ),
      chooseRestore: () =>
        call((client) =>
          client.ChooseRestore().pipe(Effect.catchTag("ReplicaFileRefused", refusedAsFailure)),
        ),
      applyRestore: () =>
        call((client) =>
          client.ApplyRestore().pipe(Effect.catchTag("ReplicaFileRefused", refusedAsFailure)),
        ),
      discardRestore: () => call((client) => client.DiscardRestore()),
    },
    openExternal: (url) => call((client) => client.ShareOpenExternal({ url })),
    copyText: (text) => call((client) => client.ShareCopyText({ text })),
    savePdf: (fileStem) => call((client) => client.ShareSavePdf({ fileStem })),
    print: (page) => call((client) => client.SharePrint({ page })),
    publish: {
      offer: (organizationId) => call((client) => client.PublishOffer({ organizationId })),
      publish: (organizationId) =>
        call((client) =>
          client
            .PublishStart({ organizationId })
            .pipe(Effect.catchTag("ReplicaFileRefused", refusedAsFailure)),
        ),
      discard: (organizationId) => call((client) => client.PublishDiscard({ organizationId })),
      localCatalog: () => call((client) => client.PublishLocalCatalog()),
      onProgress: (listener) => listen((client) => client.PublishProgress(), listener),
    },
    inventoryHttp: { getConfig: () => call((client) => client.InventoryHttpConfig()) },
    replica: {
      open: (identity) => call((client) => client.ReplicaOpen({ identity })),
      close: (workspaceToken) => call((client) => client.ReplicaClose({ workspaceToken })),
      retryRecovery: (workspaceToken) => call((client) => client.ReplicaRetry({ workspaceToken })),
    },
  };
  return updater ? { ...host, updater } : host;
};
