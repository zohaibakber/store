import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export type RendererServers = {
  readonly attach: (port: MessagePort) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
};

type RendererProtocol = Layer.Layer<RpcServer.Protocol, unknown>;

const portClosed = (port: MessagePort) =>
  Stream.fromEventListener(port, "close").pipe(Stream.runHead, Effect.asVoid);

export const makeRendererServers = <E>(
  serve: (protocol: RendererProtocol) => Layer.Layer<never, E>,
): Effect.Effect<RendererServers, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return {
      attach: (port) =>
        Layer.launch(
          Layer.fresh(
            serve(
              RpcServer.layerProtocolWorkerRunner.pipe(
                Layer.provide(BrowserWorkerRunner.layerMessagePort(port)),
              ),
            ),
          ),
        ).pipe(
          Effect.raceFirst(portClosed(port)),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("RendererServers.server_failed", cause),
          ),
          Effect.forkIn(scope),
          Effect.asVoid,
        ),
      shutdown: Scope.close(scope, Exit.void),
    };
  });

export const noRendererServers: RendererServers = {
  attach: (port) => Effect.sync(() => port.close()),
  shutdown: Effect.void,
};
