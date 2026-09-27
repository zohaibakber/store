import { it } from "@effect/vitest";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { expect } from "vitest";

import { saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { makeSyncEngine } from "../src/sqlite";
import type { SyncTransport } from "../src/transport";
import { withSeededReplica } from "./lib/replica-fixture";

const unusedTransport: SyncTransport = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.die("unused"),
};

it.live("holds an interrupt that lands between claiming a command and sending it", () =>
  withSeededReplica((store) =>
    Effect.gen(function* () {
      yield* runReplicaTransaction(store, (tx) => saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1));

      const inner = yield* Semaphore.make(1);
      const armed = yield* Ref.make(false);
      const claimed = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();

      const mutex = {
        withPermits:
          (permits: number) =>
          <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            Effect.gen(function* () {
              const result = yield* inner.withPermits(permits)(effect);
              if (yield* Ref.getAndSet(armed, false)) {
                yield* Deferred.succeed(claimed, undefined);
                yield* Deferred.await(proceed);
              }
              return result;
            }),
      };

      const engine = yield* makeSyncEngine(store, mutex, unusedTransport);
      yield* Ref.set(armed, true);

      const upload = yield* Effect.forkChild(engine.uploadOnce());
      yield* Deferred.await(claimed);

      const duringClaim = yield* runReplicaTransaction(store, (tx) =>
        tx
          .select()
          .from(commandOutbox)
          .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
          .get(),
      );
      expect(duringClaim?.status).toBe("sending");
      expect(duringClaim?.claimId).not.toBeNull();

      const interrupting = yield* Effect.forkChild(Fiber.interrupt(upload));
      yield* Effect.sleep("20 millis");
      yield* Deferred.succeed(proceed, undefined);
      yield* Fiber.join(interrupting);

      const row = yield* runReplicaTransaction(store, (tx) =>
        tx
          .select()
          .from(commandOutbox)
          .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
          .get(),
      );
      expect(row?.status).toBe("pending");
      expect(row?.claimId).toBeNull();
    }),
  ),
);
