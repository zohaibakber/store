import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import {
  COMMIT_HUB_CAPACITY,
  makeReplicaCommitHub,
  noticeFromState,
} from "../src/replica/commit-hub";

const noticeAt = (version: number) =>
  noticeFromState("database", { generationId: "1", localCommitVersion: version });

describe("replica commit hub", () => {
  it.effect("tells a subscriber that fell behind to invalidate everything", () =>
    Effect.gen(function* () {
      const hub = yield* makeReplicaCommitHub();
      const total = COMMIT_HUB_CAPACITY * 3;
      const slow = yield* hub.commits.pipe(
        Stream.tap(() => Effect.sleep("1 second")),
        Stream.takeUntil((notice) => notice.localCommitVersion === total),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      for (let version = 1; version <= total; version++) yield* hub.publish(noticeAt(version));
      yield* TestClock.adjust(`${total * 2} seconds`);
      const received = yield* Fiber.join(slow);
      expect(received.some((notice) => notice.fullInvalidation === true)).toBe(true);
      expect(received.at(-1)?.localCommitVersion).toBe(total);
    }),
  );
});
