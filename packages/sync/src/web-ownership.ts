import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export type CrossTabNotice = {
  readonly generationId: string;
  readonly localCommitVersion: number;
};

const CrossTabNoticeSchema = Schema.Struct({
  generationId: Schema.String,
  localCommitVersion: Schema.Number,
});

const decodeCrossTabNotice = Schema.decodeUnknownOption(CrossTabNoticeSchema);

export type WebNetworkOwnership = {
  readonly tryAcquire: (
    onOwner: () => Effect.Effect<void>,
  ) => Effect.Effect<{ readonly release: Effect.Effect<void> }>;
  readonly publishCrossTab: (notice: CrossTabNotice) => Effect.Effect<void>;
  readonly crossTabNotices: Stream.Stream<CrossTabNotice>;
  readonly dispose: Effect.Effect<void>;
};

const hasWebLocks = (): boolean => {
  try {
    return globalThis.navigator !== undefined && globalThis.navigator.locks !== undefined;
  } catch {
    return false;
  }
};

const queueForWebLock = (
  lockName: string,
  onOwner: () => Effect.Effect<void>,
): Effect.Effect<{ readonly release: Effect.Effect<void> }> =>
  Effect.gen(function* () {
    const released = yield* Deferred.make<void>();
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const abort = new AbortController();
    const holder = Effect.gen(function* () {
      if (yield* Deferred.isDone(released)) return;
      yield* onOwner();
      yield* Deferred.await(released);
    });
    yield* Effect.sync(() => {
      globalThis.navigator.locks
        .request(lockName, { signal: abort.signal }, () => runPromise(holder))
        .catch(() => undefined);
    });
    return {
      release: Deferred.succeed(released, undefined).pipe(
        Effect.andThen(Effect.sync(() => abort.abort())),
      ),
    };
  });

export const makeWebNetworkOwnership = (
  databaseIdentity: string,
): Effect.Effect<WebNetworkOwnership> =>
  Effect.gen(function* () {
    const lockName = `tabaaq.sync.${databaseIdentity}`;
    const channel =
      globalThis.BroadcastChannel === undefined
        ? undefined
        : new globalThis.BroadcastChannel(lockName);
    const hub = yield* PubSub.unbounded<CrossTabNotice>();

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const decoded = decodeCrossTabNotice(event.data);
        if (Option.isSome(decoded)) PubSub.publishUnsafe(hub, decoded.value);
      };
    }

    return {
      tryAcquire: (onOwner) =>
        Effect.suspend(() =>
          hasWebLocks()
            ? queueForWebLock(lockName, onOwner)
            : onOwner().pipe(Effect.as({ release: Effect.void })),
        ),
      publishCrossTab: (notice) =>
        Effect.sync(() => {
          channel?.postMessage(notice);
        }),
      crossTabNotices: Stream.fromPubSub(hub),
      dispose: Effect.sync(() => {
        channel?.close();
      }),
    } satisfies WebNetworkOwnership;
  });
