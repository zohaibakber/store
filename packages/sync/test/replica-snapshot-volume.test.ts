import { describe, expect, it } from "@effect/vitest";
import { OPERATIONAL_SUBSCRIPTION } from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import { invoiceItems, invoices, replicaState, stockMovements } from "@store/db/replica.schema";
import { count } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { TestClock } from "effect/testing";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import { recoverFrom } from "../src/session";
import {
  historicSales,
  historyAuthorityTransport,
  makeHistoryAuthority,
} from "./lib/history-authority";
import { seedCatalogGroup } from "./lib/pending-fixture";
import { FIXTURE_USER_ID } from "./lib/replica-fixture";

const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);

const INCARNATION = "incarnation-test";

describe("history snapshot volume", () => {
  it.effect(
    "imports 5k invoices, 20k items and 20k movements across many parts and verifies the digest",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          const authority = yield* makeHistoryAuthority(historicSales(5_000, 4), [
            seedCatalogGroup,
          ]);
          const handle = yield* openReplicaStore();
          yield* runReplicaTransaction(handle, (tx) =>
            tx.insert(replicaState).values({
              id: "singleton",
              organizationId: LAST_UNIT_ORGANIZATION_ID,
              userId: FIXTURE_USER_ID,
              replicaId: LAST_UNIT_REPLICA_A,
              epoch: LAST_UNIT_EPOCH,
              incarnation: INCARNATION,
              appliedCommitSequence: "0",
              nextClientSequence: "1",
              localCommitVersion: 0,
            }),
          ).pipe(Effect.orDie);
          const store = yield* makeSqliteReplicaStore(handle, "history-volume");
          const transport = historyAuthorityTransport(authority, INCARNATION);
          const mutex = yield* Semaphore.make(1);
          const engine = yield* makeSyncEngineFromReplicaStore(store, mutex, transport);

          const started = performance.now();
          yield* recoverFrom(store, transport, "SNAPSHOT_REQUIRED");
          const importMillis = performance.now() - started;
          const parts = yield* Ref.get(authority.snapshotParts);
          expect(parts.size).toBe(1 + Math.ceil(45_000 / 500));

          const caughtUp = yield* Effect.exit(engine.catchUp());
          expect(Exit.isSuccess(caughtUp)).toBe(true);
          expect(yield* store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBe(NOW);
          const counts = yield* runReplicaTransaction(handle, (tx) =>
            Effect.all({
              invoices: tx.select({ value: count() }).from(invoices).all(),
              items: tx.select({ value: count() }).from(invoiceItems).all(),
              movements: tx.select({ value: count() }).from(stockMovements).all(),
            }),
          ).pipe(Effect.orDie);
          expect(counts).toEqual({
            invoices: [{ value: 5_000 }],
            items: [{ value: 20_000 }],
            movements: [{ value: 20_000 }],
          });
          expect(importMillis).toBeLessThan(60_000);
        }),
      ),
    120_000,
  );
});
