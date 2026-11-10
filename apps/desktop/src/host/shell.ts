import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ReplicaFileRefused } from "./file-refusal";
import { fileRefusalMessage } from "./file-refusal-copy";
import { SHELL_PORT_CHANNEL } from "./shell-port-channels";
import {
  ExternalLinkRefused,
  ServerRequestFailed,
  ShellRpcs,
  SignInFailed,
  WorkspaceOpenFailed,
} from "./shell-rpcs";

export type ShellPortBridge = { readonly connect: () => void };

declare global {
  interface Window {
    shellPort?: ShellPortBridge;
  }
}

export type ShellClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ShellRpcs>, RpcClientError>;

class Shell extends Context.Service<Shell, ShellClient>()("@store/desktop/Shell") {}

class ShellBridgeMissing extends Schema.TaggedError<ShellBridgeMissing>()(
  "ShellBridgeMissing",
  {},
) {}

const shellPort = Effect.suspend(() => {
  const bridge = window.shellPort;
  if (!bridge) return Effect.die(new ShellBridgeMissing());
  return Effect.callback<MessagePort>((resume) => {
    const onMessage = (event: MessageEvent) => {
      const [port] = event.ports;
      if (event.source !== window || event.data?.type !== SHELL_PORT_CHANNEL || !port) return;
      resume(Effect.succeed(port));
    };
    window.addEventListener("message", onMessage);
    bridge.connect();
    return Effect.sync(() => window.removeEventListener("message", onMessage));
  });
});

const ShellLive = Layer.effect(Shell, RpcClient.make(ShellRpcs)).pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.map(shellPort, (port) =>
        RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
          Layer.provide(BrowserWorker.layer(() => port)),
        ),
      ),
    ),
  ),
);

const runtime = ManagedRuntime.make(ShellLive);

export const shell = runtime.contextEffect.pipe(Effect.map(Context.get(Shell)), Effect.orDie);

export class BridgeInterrupted extends Schema.TaggedError<BridgeInterrupted>()(
  "BridgeInterrupted",
  {},
) {}

const BridgeFailure = Schema.Union([
  SignInFailed,
  ServerRequestFailed,
  ExternalLinkRefused,
  WorkspaceOpenFailed,
  BridgeInterrupted,
]);

export const isBridgeFailure = Schema.is(BridgeFailure);

export const runShell = async <A, E>(
  use: (client: ShellClient) => Effect.Effect<A, E>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(Effect.flatMap(shell, use));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.hasInterruptsOnly(exit.cause) ? new BridgeInterrupted() : Cause.squash(exit.cause);
};

export const fireShell = (use: (client: ShellClient) => Effect.Effect<unknown, unknown>) => {
  runtime.runFork(Effect.flatMap(shell, use).pipe(Effect.ignore({ log: true })));
};

export const listenShell = <A>(
  stream: (client: ShellClient) => Stream.Stream<A, unknown>,
  onValue: (value: A) => void,
) => {
  const fiber = runtime.runFork(
    Effect.flatMap(shell, (client) =>
      stream(client).pipe(Stream.runForEach((value) => Effect.sync(() => onValue(value)))),
    ).pipe(Effect.ignoreCause({ log: true })),
  );
  return () => fiber.interruptUnsafe();
};

const isFileRefusal = Schema.is(ReplicaFileRefused);

export const refusedAsFailure = <A, E, R>(effect: Effect.Effect<A, E | ReplicaFileRefused, R>) =>
  Effect.catchIf(effect, isFileRefusal, (refusal) =>
    Effect.succeed({ _tag: "failed" as const, message: fileRefusalMessage(refusal) }),
  );
