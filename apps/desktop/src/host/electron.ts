import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { OrganizationId } from "@store/contracts";
import { WorkspaceToken } from "@store/contracts/replica";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ReplicaFileRefused } from "./file-refusal";
import { fileRefusalMessage } from "./file-refusal-copy";
import { BridgeInterrupted, type AppHost, type AppUpdaterBridge } from "./index";
import { SHELL_PORT_CHANNEL } from "./shell-port-channels";
import {
  ShellRpcs,
  type InventoryHttpConfig,
  ReplicaIdentity,
  type ReplicaOpened,
} from "./shell-rpcs";

const decodeOrganizationId = Schema.decodeUnknownEffect(OrganizationId);
const decodeWorkspaceToken = Schema.decodeUnknownEffect(WorkspaceToken);
const decodeIdentity = Schema.decodeUnknownEffect(ReplicaIdentity);

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

  const call = async <A, E>(use: (client: Client) => Effect.Effect<A, E>): Promise<A> => {
    const exit = await runtime.runPromiseExit(ShellClient.use(use));
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.hasInterruptsOnly(exit.cause) ? new BridgeInterrupted() : Cause.squash(exit.cause);
  };

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

  const sessions = Effect.runSync(PubSub.unbounded<WorkspaceSnapshot>({ replay: 1 }));
  listen(
    (client) => client.SessionChanges(),
    (snapshot) => PubSub.publishUnsafe(sessions, snapshot),
  );
  const published = async (snapshot: Promise<WorkspaceSnapshot>) => {
    const settled = await snapshot;
    PubSub.publishUnsafe(sessions, settled);
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

  const windowMaximized = Effect.runSync(SubscriptionRef.make(false));
  const watchWindowMaximized = once(() => {
    listen(
      (client) => client.WindowMaximized(),
      (maximized) => Effect.runSync(SubscriptionRef.set(windowMaximized, maximized)),
    );
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
      sessionChanges: Stream.fromPubSub(sessions),
    },
    signIn: {
      identify: (input) => call((client) => client.AuthIdentify(input)),
      authenticate: (credentials) =>
        published(call((client) => client.AuthAuthenticate({ credentials }))),
      beginGoogle: () => call((client) => client.AuthBeginGoogle()),
      completeGoogle: async (callbackUrl) => {
        const snapshot = await call((client) => client.AuthCompleteGoogle({ callbackUrl }));
        if (snapshot !== null) PubSub.publishUnsafe(sessions, snapshot);
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
        isMaximized: () => SubscriptionRef.getUnsafe(windowMaximized),
        onMaximizedChange: (listener) => {
          watchWindowMaximized();
          const fiber = runtime.runFork(
            SubscriptionRef.changes(windowMaximized).pipe(
              Stream.runForEach(() => Effect.sync(listener)),
            ),
          );
          return () => fiber.interruptUnsafe();
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
      offer: (organizationId) =>
        call((client) =>
          Effect.flatMap(decodeOrganizationId(organizationId), (id) =>
            client.PublishOffer({ organizationId: id }),
          ),
        ),
      publish: (organizationId) =>
        call((client) =>
          Effect.flatMap(decodeOrganizationId(organizationId), (id) =>
            client.PublishStart({ organizationId: id }),
          ).pipe(Effect.catchTag("ReplicaFileRefused", refusedAsFailure)),
        ),
      discard: (organizationId) =>
        call((client) =>
          Effect.flatMap(decodeOrganizationId(organizationId), (id) =>
            client.PublishDiscard({ organizationId: id }),
          ),
        ),
      localCatalog: () => call((client) => client.PublishLocalCatalog()),
      onProgress: (listener) => listen((client) => client.PublishProgress(), listener),
    },
    inventoryHttp: { getConfig: () => call((client) => client.InventoryHttpConfig()) },
    replica: {
      open: (identity) =>
        call((client) =>
          Effect.flatMap(decodeIdentity(identity), (decoded) =>
            client.ReplicaOpen({ identity: decoded }),
          ),
        ),
      close: (workspaceToken) =>
        call((client) =>
          Effect.flatMap(decodeWorkspaceToken(workspaceToken), (token) =>
            client.ReplicaClose({ workspaceToken: token }),
          ),
        ),
      retryRecovery: (workspaceToken) =>
        call((client) =>
          Effect.flatMap(decodeWorkspaceToken(workspaceToken), (token) =>
            client.ReplicaRetry({ workspaceToken: token }),
          ),
        ),
    },
  };
  return updater ? { ...host, updater } : host;
};
