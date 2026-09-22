import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  exportPendingCommandsFromSqlite,
  importPendingCommandsToIndexedDb,
  indexedDbReplicaDatabaseName,
  openIndexedDbForMigration,
  validatePendingCommandExport,
  type PendingCommandExport,
  type SqlitePendingCommandSource,
} from "../src/replica/migrate-pending";

const databaseName = indexedDbReplicaDatabaseName(LAST_UNIT_ORGANIZATION_ID, "user-1");

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const fixturePending = (overrides?: Partial<PendingCommandExport>): PendingCommandExport => ({
  operationId: lastUnitBuyerAEnvelope.operationId,
  status: "pending",
  envelope: lastUnitBuyerAEnvelope,
  clientSequence: lastUnitBuyerAEnvelope.clientSequence,
  createdAt: 1_700_000_000_000,
  attempts: 0,
  outcomeUncertain: false,
  commitSequence: null,
  ...overrides,
});

describe("pending command migration", () => {
  it("validates fixture identities before import", () => {
    expect(() =>
      validatePendingCommandExport([
        fixturePending({
          envelope: { ...lastUnitBuyerAEnvelope, operationId: "other" },
        }),
      ]),
    ).toThrow(/Envelope identity/);
  });

  it("exports pending rows from a SQLite-shaped fixture source", () => {
    const source: SqlitePendingCommandSource = {
      prepare: () => ({
        all: () => [
          {
            operationId: lastUnitBuyerAEnvelope.operationId,
            status: "sending",
            envelopeJson: JSON.stringify(lastUnitBuyerAEnvelope),
            clientSequence: lastUnitBuyerAEnvelope.clientSequence,
            createdAt: 1_700_000_000_000,
            attempts: 2,
            outcomeUncertain: 1,
            commitSequence: null,
          },
        ],
      }),
    };
    const exported = exportPendingCommandsFromSqlite(source);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);
    expect(exported[0]?.status).toBe("sending");
    expect(exported[0]?.outcomeUncertain).toBe(true);
    expect(exported[0]?.attempts).toBe(2);
  });

  it.effect("imports fixture pending commands into IndexedDB with a checkpoint", () =>
    Effect.gen(function* () {
      const store = yield* openIndexedDbForMigration({
        databaseName,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        userId: "user-1",
        replicaId: LAST_UNIT_REPLICA_A,
        indexedDB,
        IDBKeyRange,
      });
      const commands = [fixturePending({ status: "sending", attempts: 1, outcomeUncertain: true })];
      const checkpoint = yield* importPendingCommandsToIndexedDb(store, commands);
      expect(checkpoint.verified).toBe(true);
      expect(checkpoint.importedCount).toBe(1);
      expect(checkpoint.exportedCount).toBe(1);

      const status = yield* store.readCommandStatus(lastUnitBuyerAEnvelope.operationId);
      expect(status).toBe("sending");
      const stored = yield* store.readPendingMigrationCheckpoint();
      expect(stored).toEqual(checkpoint);
      const statuses = yield* store.listOutboxStatuses();
      expect(statuses).toEqual(["sending"]);
      yield* store.dispose();
    }),
  );
});
