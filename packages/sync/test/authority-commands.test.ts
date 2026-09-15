import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBEnvelope,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { SyncProtocolError } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { commitPreparedCommand } from "../src/authority/commands";
import {
  countInvoices,
  lastUnitActor,
  loadBatch,
  openInventoryStore,
  runCommit,
  runPull,
  seedLastUnitCatalog,
} from "../src/authority/store";

const isProtocol = (cause: unknown): cause is SyncProtocolError =>
  typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "SyncProtocolError";

describe("authority command library", () => {
  it("accepts the first last-unit sale and rejects the second without going negative", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const first = runCommit(store.db, lastUnitBuyerAEnvelope);
    const second = runCommit(store.db, lastUnitBuyerBEnvelope);
    const batch = loadBatch(store.db);
    expect(first.decision).toBe("accepted");
    expect(first.result).toMatchObject({ _tag: "issueInvoice", invoiceNumber: 1 });
    expect(second.decision).toBe("rejected");
    expect(second.result).toMatchObject({ _tag: "rejected", code: "INSUFFICIENT_STOCK" });
    expect(batch?.unitQuantity).toBe(0);
    expect(batch?.packQuantity).toBe(0);
    expect(countInvoices(store.db)).toBe(1);
    store.close();
  });

  it("returns the stored receipt on identical retry without a second invoice or sequence bump", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const first = runCommit(store.db, lastUnitBuyerAEnvelope);
    const retry = runCommit(store.db, lastUnitBuyerAEnvelope);
    expect(retry).toEqual(first);
    expect(countInvoices(store.db)).toBe(1);
    const pulled = runPull(store.db);
    expect(pulled.transactions).toHaveLength(1);
    expect(pulled.nextCommitSequence).toBe(first.commitSequence);
    store.close();
  });

  it("rejects a reused operation id with a different payload hash", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    const otherCommand = {
      ...lastUnitBuyerAEnvelope.command,
      payload: { ...lastUnitBuyerAEnvelope.command.payload, invoiceNumber: 2 },
    };
    const mismatched = {
      ...lastUnitBuyerAEnvelope,
      command: otherCommand,
      payloadHash: canonicalPayloadHash(otherCommand),
    };
    expect(() => runCommit(store.db, mismatched)).toThrowError(SyncProtocolError);
    try {
      runCommit(store.db, mismatched);
    } catch (cause) {
      expect(isProtocol(cause) && cause.code).toBe("OPERATION_ID_REUSED");
    }
    expect(countInvoices(store.db)).toBe(1);
    store.close();
  });

  it("treats a client sequence gap as a protocol failure and leaves stock unchanged", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const gapped = lastUnitEnvelope({
      replicaId: LAST_UNIT_REPLICA_A,
      clientSequence: "3",
      command: lastUnitBuyerACommand,
    });
    expect(() => runCommit(store.db, gapped)).toThrowError(SyncProtocolError);
    try {
      runCommit(store.db, gapped);
    } catch (cause) {
      expect(isProtocol(cause) && cause.code).toBe("REPLICA_SEQUENCE_GAP");
    }
    expect(loadBatch(store.db)?.unitQuantity).toBe(1);
    expect(countInvoices(store.db)).toBe(0);
    store.close();
  });

  it("rolls back domain writes when the sqlite transaction throws", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    store.sqlite.exec(`
      CREATE TRIGGER fail_after_invoice AFTER INSERT ON invoices
      BEGIN
        SELECT RAISE(FAIL, 'forced rollback');
      END;
    `);
    expect(() => runCommit(store.db, lastUnitBuyerAEnvelope)).toThrow();
    expect(loadBatch(store.db)?.unitQuantity).toBe(1);
    expect(countInvoices(store.db)).toBe(0);
    expect(runPull(store.db).transactions).toHaveLength(0);
    store.close();
  });

  it("records a rejected command on the log without changing domain qty", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    const rejected = runCommit(store.db, lastUnitBuyerBEnvelope);
    const pulled = runPull(store.db);
    expect(rejected.decision).toBe("rejected");
    expect(pulled.transactions.map((group) => group.decision)).toEqual(["accepted", "rejected"]);
    expect(pulled.transactions[1]?.changes).toEqual([]);
    expect(loadBatch(store.db)?.unitQuantity).toBe(0);
    const empty = runPull(store.db, { afterCommitSequence: pulled.nextCommitSequence });
    expect(empty.transactions).toEqual([]);
    store.close();
  });

  it("keeps commitPreparedCommand on the caller transaction handle", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const receipt = store.db.transaction((tx) =>
      commitPreparedCommand(tx as Parameters<typeof commitPreparedCommand>[0], {
        actor: lastUnitActor,
        envelope: lastUnitBuyerAEnvelope,
        receivedAt: 1,
      }),
    ) as ReturnType<typeof commitPreparedCommand>;
    expect(receipt.replicaId).toBe(LAST_UNIT_REPLICA_A);
    expect(receipt.decision).toBe("accepted");
    store.close();
  });
});
