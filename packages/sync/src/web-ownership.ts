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
        const decoded = Schema.decodeUnknownOption(CrossTabNoticeSchema)(event.data);
        if (Option.isNone(decoded)) return;
        void Effect.runFork(PubSub.publish(hub, decoded.value));
      };
    }

    const tryAcquire = (
      onOwner: () => Effect.Effect<void>,
    ): Effect.Effect<{ readonly release: Effect.Effect<void> }> =>
      Effect.callback((resume) => {
        if (!hasWebLocks()) {
          void Effect.runFork(onOwner());
          resume(Effect.succeed({ release: Effect.void }));
          return;
        }
        let released = false;
        let releaseHold: (() => void) | undefined;
        const release = Effect.sync(() => {
          released = true;
          releaseHold?.();
        });
        void globalThis.navigator.locks.request(lockName, async () => {
          if (released) {
            resume(Effect.succeed({ release }));
            return;
          }
          await Effect.runPromise(onOwner());
          resume(Effect.succeed({ release }));
          await new Promise<void>((resolve) => {
            if (released) {
              resolve();
              return;
            }
            releaseHold = resolve;
          });
        });
      });

    return {
      tryAcquire,
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
