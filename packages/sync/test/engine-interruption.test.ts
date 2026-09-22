import { it } from "@effect/vitest";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";
import { expect } from "vitest";

import { makeSyncEngine } from "../src/engine";
import { saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import type { SyncTransport } from "../src/transport";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

it.effect("returns an interrupted upload claim to pending with an uncertain outcome", () =>
  Effect.acquireUseRelease(
    Effect.sync(seedReplicaTenUnits),
    (store) =>
      Effect.gen(function* () {
        runReplicaTransaction(store.db, (tx) => {
          saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
        });
        const started = yield* Deferred.make<void>();
        const mutex = yield* Semaphore.make(1);
        const transport: SyncTransport = {
          registerReplica: () => Effect.die("unused"),
          getReceipt: () => Effect.die("unused"),
          pull: () => Effect.die("unused"),
          submitCommand: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }),
          acquireSnapshot: () => Effect.die("unused"),
          readSnapshotPart: () => Effect.die("unused"),
          mintLiveTicket: () => Effect.die("unused"),
        };
        const engine = yield* makeSyncEngine(store.db, mutex, transport);
        const upload = yield* Effect.forkChild(engine.uploadOnce());
        yield* Deferred.await(started);
        yield* Fiber.interrupt(upload);
        const row = runReplicaTransaction(store.db, (tx) =>
          tx
            .select()
            .from(commandOutbox)
            .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
            .get(),
        );
        expect(row?.status).toBe("pending");
        expect(row?.outcomeUncertain).toBe(true);
        expect(row?.claimId).toBeNull();
      }),
    (store) => Effect.sync(store.close),
  ),
);
