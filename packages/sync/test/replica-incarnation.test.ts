import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { commandStatus, saveLocalCommand, verifyReplicaIncarnation } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { withSeededReplica } from "./lib/replica-fixture";

describe("replica incarnation and identity", () => {
  it("refuses an incarnation mismatch and leaves the outbox intact", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        Effect.gen(function* () {
          yield* runReplicaTransaction(store, (tx) =>
            saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1),
          );
          const failure = yield* runReplicaTransaction(store, (tx) =>
            verifyReplicaIncarnation(tx, "incarnation-other"),
          ).pipe(Effect.flip);
          const after = yield* runReplicaTransaction(store, (tx) =>
            Effect.gen(function* () {
              const status = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
              const rows = yield* tx.select().from(commandOutbox).all();
              return { status, rows: rows.length };
            }),
          );
          return { failure, after };
        }),
      ),
    );
    expect(String(seen.failure)).toMatchInlineSnapshot(
      `"SyncProtocolError: Expected incarnation incarnation-test, received incarnation-other."`,
    );
    expect(seen.after.status).toBe("pending");
    expect(seen.after.rows).toBe(1);
  });
});
