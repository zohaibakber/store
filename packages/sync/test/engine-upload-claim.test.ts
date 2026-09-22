import { it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBCommand,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
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

it.effect("allows only one concurrent upload claim", () =>
  Effect.acquireUseRelease(
    Effect.sync(seedReplicaTenUnits),
    (store) =>
      Effect.gen(function* () {
        const secondEnvelope = lastUnitEnvelope({
          replicaId: LAST_UNIT_REPLICA_A,
          clientSequence: "2",
          command: lastUnitBuyerBCommand,
        });
        runReplicaTransaction(store.db, (tx) => {
          saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
          saveLocalCommand(tx, secondEnvelope, 2);
        });
        const firstStarted = yield* Deferred.make<void>();
        const mutex = yield* Semaphore.make(1);
        const transport: SyncTransport = {
          registerReplica: () => Effect.die("unused"),
          getReceipt: () => Effect.die("unused"),
          pull: () => Effect.die("unused"),
          submitCommand: (envelope) =>
            Effect.gen(function* () {
              if (envelope.operationId === lastUnitBuyerAEnvelope.operationId) {
                yield* Deferred.succeed(firstStarted, undefined);
                return yield* Effect.never;
              }
              return {
                operationId: envelope.operationId,
                replicaId: LAST_UNIT_REPLICA_A,
                clientSequence: envelope.clientSequence,
                payloadHash: envelope.payloadHash,
                decision: "accepted" as const,
                commitSequence: OrgCommitSequence.make("2"),
                result: {
                  _tag: "issueInvoice" as const,
                  invoiceId: envelope.command.payload.invoiceId,
                  invoiceNumber: 2,
                },
              };
            }),
          acquireSnapshot: () => Effect.die("unused"),
          readSnapshotPart: () => Effect.die("unused"),
          mintLiveTicket: () => Effect.die("unused"),
        };
        const engine = yield* makeSyncEngine(store.db, mutex, transport);
        const first = yield* Effect.forkChild(engine.uploadOnce());
        yield* Deferred.await(firstStarted);
        const second = yield* Effect.forkChild(engine.uploadOnce());
        const secondResult = yield* Fiber.join(second);
        expect(secondResult).toBeUndefined();
        const sending = runReplicaTransaction(store.db, (tx) =>
          tx.select().from(commandOutbox).where(eq(commandOutbox.status, "sending")).all(),
        );
        expect(sending).toHaveLength(1);
        expect(sending[0]?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);
        yield* Fiber.interrupt(first);
      }),
    (store) => Effect.sync(store.close),
  ),
);
