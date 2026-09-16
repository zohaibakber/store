import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { liveSessions } from "@store/db/inventory.schema";
import { describe, expect, it } from "vitest";

import { openLiveSession } from "../src/authority/delivery";
import {
  lastUnitActor,
  openInventoryStore,
  runCommit,
  seedLastUnitCatalog,
} from "../src/authority/store";
import { armWake, nextWakeDeadline, recordArmedWake, wakeDebt } from "../src/authority/wake";
import { runSqliteTransaction } from "../src/sqlite";

const NOW = 1_700_000_000_000;

describe("authority wake debt", () => {
  it("reports overdue when the armed deadline trails a live session that is behind head", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    const debt = runSqliteTransaction(store.db, (tx) => {
      recordArmedWake(tx, armWake(LAST_UNIT_ORGANIZATION_ID, NOW + 10_000, "retention"));
      openLiveSession(tx, {
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        sessionId: "socket-1",
        replicaId: LAST_UNIT_REPLICA_A,
        ownerUserId: lastUnitActor.userId,
        subscription: "operational",
        deliveredThroughCommitSequence: "0",
        leaseExpiresAt: NOW + 5_000,
      });
      return wakeDebt(tx, LAST_UNIT_ORGANIZATION_ID, NOW);
    });
    expect(debt).toEqual({
      _tag: "overdue",
      deadline: { reason: "delivery", dueAt: NOW },
      armedDueAt: NOW + 10_000,
    });
    store.close();
  });

  it("settles when the same transaction arms the earliest obligation it created", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    const result = runSqliteTransaction(store.db, (tx) => {
      openLiveSession(tx, {
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        sessionId: "socket-1",
        replicaId: LAST_UNIT_REPLICA_A,
        ownerUserId: lastUnitActor.userId,
        subscription: "operational",
        deliveredThroughCommitSequence: "0",
        leaseExpiresAt: NOW + 5_000,
      });
      const armed = nextWakeDeadline(tx, LAST_UNIT_ORGANIZATION_ID, NOW);
      if (armed === undefined) {
        throw new Error("expected a wake deadline");
      }
      recordArmedWake(tx, armed);
      return {
        dueAt: armed.dueAt,
        reason: armed.reason,
        debt: wakeDebt(tx, LAST_UNIT_ORGANIZATION_ID, NOW),
      };
    });
    expect(result).toEqual({
      dueAt: NOW,
      reason: "delivery",
      debt: { _tag: "settled" },
    });
    expect(
      store.db
        .select()
        .from(liveSessions)
        .all()
        .map((row) => row.sessionId),
    ).toEqual(["socket-1"]);
    store.close();
  });
});
