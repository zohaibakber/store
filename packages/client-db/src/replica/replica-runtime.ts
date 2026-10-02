import type { CommandStatus } from "@store/contracts";
import type { ReplicaStore } from "@store/sync/browser";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Scope from "effect/Scope";

import { layerCommitForwarding } from "./commit-forwarding";
import { makeReplicaLifetime } from "./lifetime";
import { createReplicaCommitPublisher } from "./publisher";
import type {
  EnqueuedCommand,
  ReplicaChangeFeed,
  ReplicaCommitNotice,
  ReplicaReadOptions,
} from "./types";

export type ReplicaRun<R> = <A, E>(
  effect: Effect.Effect<A, E, R>,
  options?: ReplicaReadOptions,
) => Promise<A>;

type ReplicaRuntime<R, Booted> = {
  readonly booted: Booted;
  readonly run: ReplicaRun<R>;
  readonly subscribe: ReplicaChangeFeed["subscribe"];
  readonly publish: (notice: ReplicaCommitNotice) => void;
  readonly scope: Scope.Scope;
  readonly close: () => Promise<void>;
};

export const openReplicaRuntime = async <R, ER, Booted, E>(
  workspaceToken: string,
  layer: (commitForwarding: Layer.Layer<never, never, ReplicaStore>) => Layer.Layer<R, ER>,
  boot: Effect.Effect<Booted, E, NoInfer<R>>,
): Promise<ReplicaRuntime<R, Booted>> => {
  const publisher = createReplicaCommitPublisher();
  const runtime = ManagedRuntime.make(layer(layerCommitForwarding(workspaceToken, publisher)));
  const booted = await runtime.runPromise(boot).catch(async (cause: unknown) => {
    await runtime.dispose();
    throw cause;
  });

  const lifetime = makeReplicaLifetime();
  lifetime.onClose(Effect.promise(() => runtime.dispose()));
  lifetime.onClose(Effect.promise(() => publisher.dispose()));

  return {
    booted,
    run: (effect, options) =>
      runtime.runPromise(
        lifetime.supervise(effect),
        options?.signal === undefined ? undefined : { signal: options.signal },
      ),
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    scope: lifetime.scope,
    close: lifetime.close,
  };
};

export const enqueuedCommand = (
  workspaceToken: string,
  queued: {
    readonly operationId: string;
    readonly status: CommandStatus;
    readonly stamp: { readonly generationId: string; readonly localCommitVersion: number };
  },
): EnqueuedCommand => ({
  operationId: queued.operationId,
  status: queued.status,
  stamp: { workspaceToken, ...queued.stamp },
});
