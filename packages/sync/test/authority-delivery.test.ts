import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { describe, expect, it } from "vitest";

import {
  consumeLiveTicket,
  decideDelivery,
  mintLiveTicket,
  openLiveSession,
  recordDelivered,
} from "../src/authority/delivery";
import {
  lastUnitActor,
  openInventoryStore,
  runCommit,
  seedLastUnitCatalog,
} from "../src/authority/store";
import { runSqliteTransaction } from "../src/sqlite";

const NOW = 1_700_000_000_000;
const NONCE = "aa".repeat(32);

describe("authority live delivery", () => {
  it("consumes a minted ticket once and then rejects the same nonce", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const minted = runSqliteTransaction(store.db, (tx) =>
      mintLiveTicket(tx, LAST_UNIT_ORGANIZATION_ID, LAST_UNIT_REPLICA_A, NONCE, NOW),
    );
    expect(minted._tag).toBe("minted");
    if (minted._tag !== "minted") {
      throw new Error("mint must succeed");
    }
    expect(minted.expiresAt).toBe(NOW + 30_000);
    const first = runSqliteTransaction(store.db, (tx) =>
      consumeLiveTicket(tx, LAST_UNIT_ORGANIZATION_ID, NONCE, NOW),
    );
    expect(first).toEqual({
      _tag: "consumed",
      nonceHash: minted.nonceHash,
      expiresAt: NOW + 30_000,
    });
    const second = runSqliteTransaction(store.db, (tx) =>
      consumeLiveTicket(tx, LAST_UNIT_ORGANIZATION_ID, NONCE, NOW),
    );
    expect(second).toEqual({ _tag: "rejected", reason: "ticket_invalid" });
    store.close();
  });

  it("returns the bounded transaction group a behind session is owed", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const receipt = runCommit(store.db, lastUnitBuyerAEnvelope);
    runSqliteTransaction(store.db, (tx) => {
      openLiveSession(tx, {
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        sessionId: "socket-1",
        replicaId: LAST_UNIT_REPLICA_A,
        ownerUserId: lastUnitActor.userId,
        subscription: "operational",
        deliveredThroughCommitSequence: "0",
        leaseExpiresAt: NOW + 60_000,
      });
    });
    const decision = runSqliteTransaction(store.db, (tx) =>
      decideDelivery(tx, LAST_UNIT_ORGANIZATION_ID, 20),
    );
    expect(decision._tag).toBe("send");
    if (decision._tag !== "send") {
      throw new Error("session must be owed a frame");
    }
    expect(decision.sessionId).toBe("socket-1");
    expect(decision.fromCommitSequence).toBe("1");
    expect(decision.toCommitSequence).toBe("1");
    expect(decision.transactions.map((group) => group.commitSequence)).toEqual(["1"]);
    expect(decision.transactions[0]?.operationId).toBe(receipt.operationId);
    runSqliteTransaction(store.db, (tx) => {
      recordDelivered(tx, LAST_UNIT_ORGANIZATION_ID, "socket-1", "1");
    });
    const idle = runSqliteTransaction(store.db, (tx) =>
      decideDelivery(tx, LAST_UNIT_ORGANIZATION_ID, 20),
    );
    expect(idle).toEqual({ _tag: "idle" });
    store.close();
  });
});
