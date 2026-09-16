import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { describe, expect, it } from "vitest";

import {
  commandStatus,
  openReplicaIdentity,
  saveLocalCommand,
  verifyReplicaIncarnation,
} from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

describe("replica incarnation and identity", () => {
  it("refuses an incarnation mismatch and leaves the outbox intact", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
    });
    expect(() =>
      runReplicaTransaction(store.db, (tx) => {
        verifyReplicaIncarnation(tx, "incarnation-other");
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[SyncProtocolError: Expected incarnation incarnation-test, received incarnation-other.]`,
    );
    runReplicaTransaction(store.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("pending");
      expect(tx.select().from(commandOutbox).all()).toHaveLength(1);
    });
    store.close();
  });

  it("refuses a new replica identity while unsent commands remain", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
    });
    expect(() =>
      runReplicaTransaction(store.db, (tx) => {
        openReplicaIdentity(tx, {
          replicaId: "replica-new",
          adoptPendingOutbox: false,
        });
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[SyncProtocolError: Unsent commands remain for the previous replica identity.]`,
    );
    runReplicaTransaction(store.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("pending");
    });
    store.close();
  });
});
