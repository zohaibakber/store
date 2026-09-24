import { describe, expect, it } from "@effect/vitest";
import { syncProtocolError, type SyncProtocolCode } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { TestClock } from "effect/testing";

import { IndexedDbQuotaExceeded, SyncRecoveryRequired } from "../src/replica/errors";
import { makeSyncScheduler, type SyncSchedulerPolicy } from "../src/scheduler";
import {
  type SyncFailureCause,
  SyncTransportAuthRequired,
  SyncTransportInvalid,
  SyncTransportOffline,
  SyncTransportUnavailable,
} from "../src/transport";

const policy: SyncSchedulerPolicy = {
  activePollMillis: 1_000,
  backoffMillis: [2_000, 4_000],
  hiddenPollMillis: 60_000,
  liveIdlePollMillis: 300_000,
  maxRetryAfterMillis: 600_000,
};

const startScheduler = (
  failure: SyncFailureCause,
  recover?: (code: SyncProtocolCode) => Effect.Effect<void, SyncFailureCause>,
) =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const scheduler = yield* makeSyncScheduler(
      {
        drainUpload: () => Effect.void,
        catchUp: () =>
          Ref.updateAndGet(attempts, (n) => n + 1).pipe(Effect.flatMap(() => Effect.fail(failure))),
        recover,
      },
      policy,
    );
    yield* scheduler.setNetworkOwner(true);
    yield* TestClock.adjust("0 millis");
    return { attempts, scheduler };
  });

describe("sync scheduler failure policy", () => {
  it.effect("honours Retry-After instead of the backoff delay", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        SyncTransportUnavailable.make({
          message: "busy",
          status: 503,
          retryAfterMillis: 30_000,
        }),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("29999 millis");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect(yield* Ref.get(attempts)).toBe(2);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("pauses for auth renewal until an explicit wake", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        SyncTransportAuthRequired.make({ message: "expired", status: 401 }),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({
        _tag: "pausedForAuth",
        status: 401,
      });
      yield* TestClock.adjust("10 minutes");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* scheduler.wake("reconnect");
      yield* TestClock.adjust("0 millis");
      expect(yield* Ref.get(attempts)).toBe(2);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("stops on malformed protocol data and surfaces the status", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        SyncTransportInvalid.make({ message: "unreadable page", status: 400 }),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({
        _tag: "stopped",
        status: 400,
        message: "unreadable page",
      });
      yield* scheduler.wake("localWrite");
      yield* TestClock.adjust("10 minutes");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("backs off exponentially within the jitter bounds", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        SyncTransportOffline.make({ message: "offline" }),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("1599 millis");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("801 millis");
      expect(yield* Ref.get(attempts)).toBe(2);
      yield* TestClock.adjust("2399 millis");
      expect(yield* Ref.get(attempts)).toBe(2);
      yield* TestClock.adjust("2401 millis");
      expect(yield* Ref.get(attempts)).toBe(3);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("routes a recoverable protocol error to the recovery handler", () =>
    Effect.gen(function* () {
      const recovered = yield* Ref.make<ReadonlyArray<SyncProtocolCode>>([]);
      const { attempts, scheduler } = yield* startScheduler(
        syncProtocolError("EPOCH_MISMATCH", "stale epoch"),
        (code) => Ref.update(recovered, (codes) => [...codes, code]),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* Ref.get(recovered)).toEqual(["EPOCH_MISMATCH"]);
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({ _tag: "running" });
      yield* scheduler.shutdown;
    }),
  );

  it.effect("stops with a storage-error status instead of retrying a local storage failure", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        IndexedDbQuotaExceeded.make({ message: "IndexedDB quota exceeded." }),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({
        _tag: "storageError",
        message: "IndexedDB quota exceeded.",
      });
      yield* scheduler.wake("localWrite");
      yield* TestClock.adjust("10 minutes");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("stops with a recovery status when the recovery handler requires an operator", () =>
    Effect.gen(function* () {
      const { attempts, scheduler } = yield* startScheduler(
        syncProtocolError("INCARNATION_MISMATCH", "restored"),
        (code) => Effect.fail(SyncRecoveryRequired.make({ code, message: "restored" })),
      );
      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({
        _tag: "recoveryRequired",
        code: "INCARNATION_MISMATCH",
        message: "restored",
      });
      yield* TestClock.adjust("10 minutes");
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* scheduler.shutdown;
    }),
  );

  it.effect("surfaces a replica sequence gap without resending and keeps downloading", () =>
    Effect.gen(function* () {
      const uploads = yield* Ref.make(0);
      const downloads = yield* Ref.make(0);
      const scheduler = yield* makeSyncScheduler(
        {
          drainUpload: () =>
            Ref.update(uploads, (n) => n + 1).pipe(
              Effect.andThen(
                Effect.fail(syncProtocolError("REPLICA_SEQUENCE_GAP", "Expected 3, received 4.")),
              ),
            ),
          catchUp: () => Ref.update(downloads, (n) => n + 1),
        },
        policy,
      );
      yield* scheduler.setNetworkOwner(true);
      yield* TestClock.adjust("0 millis");
      expect(yield* SubscriptionRef.get(scheduler.status)).toEqual({
        _tag: "recoveryRequired",
        code: "REPLICA_SEQUENCE_GAP",
        message: "Expected 3, received 4.",
      });
      expect(yield* Ref.get(uploads)).toBe(1);
      expect(yield* Ref.get(downloads)).toBe(1);

      yield* TestClock.adjust("10 minutes");
      yield* scheduler.wake("localWrite");
      yield* TestClock.adjust("0 millis");
      expect(yield* Ref.get(uploads)).toBe(1);
      expect(yield* Ref.get(downloads)).toBeGreaterThan(2);
      expect((yield* SubscriptionRef.get(scheduler.status))._tag).toBe("recoveryRequired");
      yield* scheduler.shutdown;
    }),
  );
});
