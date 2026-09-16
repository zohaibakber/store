import {
  InventoryImportId,
  InventoryReleaseId,
  LiveTicketNonce,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  padDecimalSequence,
  SnapshotId,
  SyncEpoch,
  SyncProtocolError,
} from "@store/contracts";
import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { liveSessions, snapshotParts, wakeState } from "@store/db/inventory.schema";
import { openLiveSession, runSqliteTransaction, startSnapshotJob } from "@store/sync";
import {
  LAST_UNIT_USER_ID,
  lastUnitActor,
  openInventoryStore,
  runCommit,
  seedLastUnitCatalog,
} from "@store/sync/authority/store";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  acceptLiveUpgrade,
  handleLiveClientMessage,
  mintRoutedLiveTicket,
  prepareWakePass,
  pullRoutedTransactions,
  runWakePass,
  settleWakeUpload,
  type InventoryTransactionHost,
} from "../../src/inventory/organization-host";

const isProtocol = Schema.is(SyncProtocolError);
const release = (value: string) => Schema.decodeUnknownSync(InventoryReleaseId)(value);
const importId = (value: string) => Schema.decodeUnknownSync(InventoryImportId)(value);
const nonce = Schema.decodeUnknownSync(LiveTicketNonce)("aa".repeat(32));

const NOW = 1_700_000_000_000;

const route = {
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  importId: importId("import-test"),
  releaseId: release("release-test"),
};

const actor = {
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  userId: LAST_UNIT_USER_ID,
  authorizationExpiresAt: NOW + 900_000,
};

const hostFor = (store: ReturnType<typeof openInventoryStore>): InventoryTransactionHost => ({
  transaction: (run) => runSqliteTransaction(store.db, run),
});

const openBehindSession = (db: InventoryTransactionHost) => {
  db.transaction((tx) => {
    openLiveSession(tx, {
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      sessionId: LAST_UNIT_REPLICA_A,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: lastUnitActor.userId,
      subscription: OPERATIONAL_SUBSCRIPTION,
      deliveredThroughCommitSequence: "0",
      leaseExpiresAt: NOW + 60_000,
    });
  });
};

describe("organization host wiring", () => {
  it("re-arms retention when an alarm pass has nothing due", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const result = runWakePass(hostFor(store), LAST_UNIT_ORGANIZATION_ID, NOW, {
        send: () => {
          throw new Error("no delivery");
        },
        upload: () => {
          throw new Error("no upload");
        },
      });
      expect(result).toEqual({
        dueAt: NOW + 60_000,
        reason: "retention",
      });
      expect(
        store.db
          .select()
          .from(wakeState)
          .where(eq(wakeState.organizationId, LAST_UNIT_ORGANIZATION_ID))
          .get(),
      ).toEqual({
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        armedDueAt: NOW + 60_000,
        reason: "retention",
      });
    } finally {
      store.close();
    }
  });

  it("does not clear a wake that a pending delivery still needs", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      runCommit(store.db, lastUnitBuyerAEnvelope);
      const db = hostFor(store);
      openBehindSession(db);
      const result = runWakePass(db, LAST_UNIT_ORGANIZATION_ID, NOW, {
        send: () => false,
        upload: () => {
          throw new Error("no upload");
        },
      });
      expect(result).toEqual({
        dueAt: NOW,
        reason: "delivery",
      });
      expect(
        store.db
          .select()
          .from(liveSessions)
          .where(eq(liveSessions.sessionId, LAST_UNIT_REPLICA_A))
          .get()?.deliveredThroughCommitSequence,
      ).toBe(padDecimalSequence("0"));
      const armed = store.db
        .select()
        .from(wakeState)
        .where(eq(wakeState.organizationId, LAST_UNIT_ORGANIZATION_ID))
        .get();
      expect(armed?.armedDueAt).toBe(NOW);
      expect(armed?.reason).toBe("delivery");
    } finally {
      store.close();
    }
  });

  it("advances the delivered position for a due live frame and re-reads before re-arming", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      runCommit(store.db, lastUnitBuyerAEnvelope);
      const db = hostFor(store);
      openBehindSession(db);
      const sent: Array<string> = [];
      const result = runWakePass(db, LAST_UNIT_ORGANIZATION_ID, NOW, {
        send: (_sessionId, frame) => {
          sent.push(frame._tag);
          if (frame._tag === "transactions") {
            expect(frame.fromCommitSequence).toBe("1");
            expect(frame.toCommitSequence).toBe("1");
            expect(frame.transactions.map((group) => group.commitSequence)).toEqual(["1"]);
          }
          return true;
        },
        upload: () => {
          throw new Error("no upload");
        },
      });
      expect(sent).toEqual(["transactions"]);
      expect(
        store.db
          .select()
          .from(liveSessions)
          .where(eq(liveSessions.sessionId, LAST_UNIT_REPLICA_A))
          .get()?.deliveredThroughCommitSequence,
      ).toBe(padDecimalSequence("1"));
      expect(result).toEqual({
        dueAt: NOW + 60_000,
        reason: "leaseExpiry",
      });
      const armed = store.db
        .select()
        .from(wakeState)
        .where(eq(wakeState.organizationId, LAST_UNIT_ORGANIZATION_ID))
        .get();
      expect(armed?.armedDueAt).toBe(NOW + 60_000);
      expect(armed?.reason).toBe("leaseExpiry");
    } finally {
      store.close();
    }
  });

  it("consumes a live ticket once and rejects the second consume", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const db = hostFor(store);
      const ticket = mintRoutedLiveTicket(
        db,
        {
          route,
          actor,
          input: { replicaId: LAST_UNIT_REPLICA_A, subscription: OPERATIONAL_SUBSCRIPTION },
        },
        NOW,
        nonce,
      );
      expect(ticket).toEqual({
        nonce,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        subscription: OPERATIONAL_SUBSCRIPTION,
        expiresAt: NOW + 30_000,
      });
      const attachment = acceptLiveUpgrade(db, {
        nonce,
        replicaId: LAST_UNIT_REPLICA_A,
        subscription: OPERATIONAL_SUBSCRIPTION,
        userId: LAST_UNIT_USER_ID,
        authorizationExpiresAt: NOW + 900_000,
        now: NOW,
      });
      expect(attachment.replicaId).toBe(LAST_UNIT_REPLICA_A);
      expect(attachment.acknowledgedCommitSequence).toBe("0");
      try {
        acceptLiveUpgrade(db, {
          nonce,
          replicaId: LAST_UNIT_REPLICA_A,
          subscription: OPERATIONAL_SUBSCRIPTION,
          userId: LAST_UNIT_USER_ID,
          authorizationExpiresAt: NOW + 900_000,
          now: NOW,
        });
        throw new Error("expected TICKET_INVALID");
      } catch (error) {
        expect(isProtocol(error)).toBe(true);
        if (isProtocol(error)) {
          expect(error.code).toBe("TICKET_INVALID");
        }
      }
    } finally {
      store.close();
    }
  });

  it("returns an explicit resume frame for an unparseable client message", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const db = hostFor(store);
      mintRoutedLiveTicket(
        db,
        {
          route,
          actor,
          input: { replicaId: LAST_UNIT_REPLICA_A, subscription: OPERATIONAL_SUBSCRIPTION },
        },
        NOW,
        nonce,
      );
      const attachment = acceptLiveUpgrade(db, {
        nonce,
        replicaId: LAST_UNIT_REPLICA_A,
        subscription: OPERATIONAL_SUBSCRIPTION,
        userId: LAST_UNIT_USER_ID,
        authorizationExpiresAt: NOW + 900_000,
        now: NOW,
      });
      expect(handleLiveClientMessage(db, attachment, "{", NOW)).toEqual({
        _tag: "resume",
        frame: {
          _tag: "resume",
          epoch: SyncEpoch.make("1"),
          reason: "send_window_lost",
          fromCommitSequence: "0",
        },
      });
    } finally {
      store.close();
    }
  });

  it("does not hold a SQL transaction across a snapshot upload", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const db = hostFor(store);
      db.transaction((tx) =>
        startSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, SnapshotId.make("snap-1"), NOW),
      );
      let uploads = 0;
      let heldTransaction: boolean | undefined;
      for (let step = 0; step < 20 && uploads === 0; step += 1) {
        runWakePass(db, LAST_UNIT_ORGANIZATION_ID, NOW, {
          send: () => {
            throw new Error("no delivery");
          },
          upload: () => {
            heldTransaction = store.sqlite.inTransaction;
            uploads += 1;
          },
        });
      }
      expect(uploads).toBe(1);
      expect(heldTransaction).toBe(false);
      expect(
        store.db
          .select()
          .from(snapshotParts)
          .all()
          .map((row) => row.partNumber),
      ).toEqual([1]);
    } finally {
      store.close();
    }
  });

  it("treats a stale snapshot fence settlement as a no-op", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const db = hostFor(store);
      db.transaction((tx) =>
        startSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, SnapshotId.make("snap-1"), NOW),
      );
      let prepared = prepareWakePass(db, LAST_UNIT_ORGANIZATION_ID, NOW);
      for (let step = 0; step < 20 && prepared.snapshot._tag !== "upload"; step += 1) {
        prepared = prepareWakePass(db, LAST_UNIT_ORGANIZATION_ID, NOW);
      }
      expect(prepared.snapshot._tag).toBe("upload");
      if (prepared.snapshot._tag !== "upload") {
        throw new Error("upload step required");
      }
      const settled = settleWakeUpload(
        db,
        LAST_UNIT_ORGANIZATION_ID,
        {
          _tag: "upload",
          fence: { snapshotId: prepared.snapshot.fence.snapshotId, value: 0 },
          part: prepared.snapshot.part,
          objectKey: prepared.snapshot.objectKey,
          byteLength: prepared.snapshot.byteLength,
          sha256: prepared.snapshot.sha256,
        },
        NOW,
      );
      expect(settled).toEqual({ _tag: "staleFence" });
      expect(
        store.db
          .select()
          .from(snapshotParts)
          .all()
          .map((row) => row.partNumber),
      ).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("returns a partition digest on a complete pull horizon", () => {
    const store = openInventoryStore();
    try {
      seedLastUnitCatalog(store.db);
      const pulled = pullRoutedTransactions(hostFor(store), {
        route,
        actor,
        input: {
          epoch: SyncEpoch.make("1"),
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("0"),
        },
      });
      expect(pulled.nextCommitSequence).toBe("0");
      expect(pulled.horizon).toBe("0");
      expect(pulled.digest).toBe(
        "c2437311055fd83e378d0236fa546402aea005a1233e33818615b698a256d25f",
      );
    } finally {
      store.close();
    }
  });
});
