import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { makeSyncScheduler } from "../src/scheduler";
import { makeWebNetworkOwnership } from "../src/web-ownership";

type LockManagerLike = {
  readonly request: (name: string, callback: () => Promise<void>) => Promise<void>;
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
    request: async (_name, callback) => {
      while (held) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
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
        expect(yield* Ref.get(owners)).toEqual(["first"]);
        const secondFiber = yield* Effect.forkChild(
          second.tryAcquire(() => Ref.update(owners, (current) => [...current, "second"])),
        );
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));
        expect(yield* Ref.get(owners)).toEqual(["first"]);
        yield* firstHandle.release;
        const secondHandle = yield* Fiber.join(secondFiber);
        expect(yield* Ref.get(owners)).toEqual(["first", "second"]);
        yield* secondHandle.release;
        yield* first.dispose;
        yield* second.dispose;
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
