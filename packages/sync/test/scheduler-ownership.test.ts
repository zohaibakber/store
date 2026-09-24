import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { makeSyncScheduler } from "../src/scheduler";
import { makeWebNetworkOwnership } from "../src/web-ownership";

type LockOptions = { readonly signal?: AbortSignal };

type LockManagerLike = {
  readonly request: (
    name: string,
    options: LockOptions,
    callback: () => Promise<void>,
  ) => Promise<void>;
};

const withNavigatorLocks = <A, E, R>(
  locks: LockManagerLike | undefined,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: locks ? { locks } : undefined,
    });
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: previousNavigator,
          });
        }),
      ),
    );
  });

const queuedLocks = (): LockManagerLike => {
  let held = false;
  const waiters: Array<() => void> = [];
  return {
    request: async (_name, options, callback) => {
      while (held) {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          options.signal?.addEventListener("abort", () => {
            waiters.splice(waiters.indexOf(resolve), 1);
            reject(new Error("AbortError"));
          });
        });
      }
      if (options.signal?.aborted) throw new Error("AbortError");
      held = true;
      try {
        await callback();
      } finally {
        held = false;
        const next = waiters.shift();
        next?.();
      }
    },
  };
};

const settle = (millis: number) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, millis)));

describe("web network ownership", () => {
  it.effect("acquires immediately when Web Locks are unavailable", () =>
    withNavigatorLocks(
      undefined,
      Effect.gen(function* () {
        const ownership = yield* makeWebNetworkOwnership("sched-test-db");
        const owned = yield* Ref.make(false);
        const handle = yield* ownership.tryAcquire(() => Ref.set(owned, true));
        expect(yield* Ref.get(owned)).toBe(true);
        yield* handle.release;
        yield* ownership.dispose;
      }),
    ),
  );

  it.live("releases leadership so a later acquirer can become owner", () =>
    withNavigatorLocks(
      queuedLocks(),
      Effect.gen(function* () {
        const first = yield* makeWebNetworkOwnership("leader-loss-a");
        const second = yield* makeWebNetworkOwnership("leader-loss-a");
        const owners = yield* Ref.make<ReadonlyArray<string>>([]);
        const firstHandle = yield* first.tryAcquire(() =>
          Ref.update(owners, (current) => [...current, "first"]),
        );
        yield* settle(10);
        expect(yield* Ref.get(owners)).toEqual(["first"]);
        const secondHandle = yield* second.tryAcquire(() =>
          Ref.update(owners, (current) => [...current, "second"]),
        );
        yield* settle(20);
        expect(yield* Ref.get(owners)).toEqual(["first"]);
        yield* firstHandle.release;
        yield* settle(10);
        expect(yield* Ref.get(owners)).toEqual(["first", "second"]);
        yield* secondHandle.release;
        yield* first.dispose;
        yield* second.dispose;
      }),
    ),
  );

  it.live("opens a follower tab without waiting for the lock", () =>
    withNavigatorLocks(
      queuedLocks(),
      Effect.gen(function* () {
        const leader = yield* makeWebNetworkOwnership("follower-open");
        const follower = yield* makeWebNetworkOwnership("follower-open");
        const leaderHandle = yield* leader.tryAcquire(() => Effect.void);
        yield* settle(10);
        const followerHandle = yield* follower
          .tryAcquire(() => Effect.void)
          .pipe(Effect.timeoutOption("50 millis"));
        expect(Option.isSome(followerHandle)).toBe(true);
        yield* leaderHandle.release;
        if (Option.isSome(followerHandle)) yield* followerHandle.value.release;
      }),
    ),
  );

  it.live("a follower released before the grant never becomes owner", () =>
    withNavigatorLocks(
      queuedLocks(),
      Effect.gen(function* () {
        const leader = yield* makeWebNetworkOwnership("follower-cancel");
        const follower = yield* makeWebNetworkOwnership("follower-cancel");
        const third = yield* makeWebNetworkOwnership("follower-cancel");
        const owners = yield* Ref.make<ReadonlyArray<string>>([]);
        const leaderHandle = yield* leader.tryAcquire(() => Effect.void);
        yield* settle(10);
        const followerHandle = yield* follower.tryAcquire(() =>
          Ref.update(owners, (current) => [...current, "follower"]),
        );
        const thirdHandle = yield* third.tryAcquire(() =>
          Ref.update(owners, (current) => [...current, "third"]),
        );
        yield* followerHandle.release;
        yield* leaderHandle.release;
        yield* settle(20);
        expect(yield* Ref.get(owners)).toEqual(["third"]);
        yield* thirdHandle.release;
      }),
    ),
  );

  it.live("publishCrossTab delivers invalidation notices to siblings", () =>
    Effect.gen(function* () {
      class Channel {
        static peers = new Map<string, Set<Channel>>();
        readonly name: string;
        onmessage: ((event: MessageEvent) => void) | null = null;
        constructor(name: string) {
          this.name = name;
          const peers = Channel.peers.get(name) ?? new Set();
          peers.add(this);
          Channel.peers.set(name, peers);
        }
        postMessage(data: { readonly generationId: string; readonly localCommitVersion: number }) {
          for (const peer of Channel.peers.get(this.name) ?? []) {
            if (peer === this) continue;
            peer.onmessage?.(new MessageEvent("message", { data }));
          }
        }
        close() {
          Channel.peers.get(this.name)?.delete(this);
        }
      }
      const previousChannel = globalThis.BroadcastChannel;
      Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        value: Channel,
      });
      try {
        const publisher = yield* makeWebNetworkOwnership("cross-tab");
        const subscriber = yield* makeWebNetworkOwnership("cross-tab");
        const notices = yield* Ref.make<
          ReadonlyArray<{ generationId: string; localCommitVersion: number }>
        >([]);
        const fiber = yield* Effect.forkChild(
          subscriber.crossTabNotices.pipe(
            Stream.take(1),
            Stream.runForEach((notice) => Ref.update(notices, (current) => [...current, notice])),
          ),
        );
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));
        yield* publisher.publishCrossTab({ generationId: "2", localCommitVersion: 9 });
        yield* Fiber.join(fiber);
        expect(yield* Ref.get(notices)).toEqual([{ generationId: "2", localCommitVersion: 9 }]);
        yield* publisher.dispose;
        yield* subscriber.dispose;
      } finally {
        Object.defineProperty(globalThis, "BroadcastChannel", {
          configurable: true,
          value: previousChannel,
        });
      }
    }),
  );
});

describe("sync scheduler ownership gate", () => {
  it.live("drains upload only while network owner", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const scheduler = yield* makeSyncScheduler({
        drainUpload: () => Ref.update(drains, (n) => n + 1),
        catchUp: () => Effect.void,
      });
      yield* scheduler.wake("localWrite");
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 30)));
      expect(yield* Ref.get(drains)).toBe(0);
      yield* scheduler.setNetworkOwner(true);
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 30)));
      expect(yield* Ref.get(drains)).toBeGreaterThan(0);
      yield* scheduler.shutdown;
    }),
  );

  it.live("follower wakes never drain after ownership is released", () =>
    Effect.gen(function* () {
      const drains = yield* Ref.make(0);
      const scheduler = yield* makeSyncScheduler(
        {
          drainUpload: () => Ref.update(drains, (n) => n + 1),
          catchUp: () => Effect.void,
        },
        {
          activePollMillis: 5_000,
          backoffMillis: [5_000],
          hiddenPollMillis: 5_000,
          liveIdlePollMillis: 5_000,
        },
      );
      yield* scheduler.setNetworkOwner(true);
      yield* scheduler.wake("localWrite");
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));
      const whileOwner = yield* Ref.get(drains);
      expect(whileOwner).toBeGreaterThan(0);
      yield* scheduler.setNetworkOwner(false);
      yield* scheduler.wake("localWrite");
      yield* scheduler.wake("live");
      yield* scheduler.wake("reconnect");
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 40)));
      expect(yield* Ref.get(drains)).toBe(whileOwner);
      yield* scheduler.shutdown;
    }),
  );
});
