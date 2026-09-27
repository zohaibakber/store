import { it } from "@effect/vitest";
import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { expect } from "vitest";

import { makeSyncEngine } from "../src/sqlite";
import type { SyncTransport } from "../src/transport";
import { withSeededReplica } from "./lib/replica-fixture";

const unusedTransport: SyncTransport = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.die("unused"),
};

it.effect("reports a replica sequence gap as a protocol error", () =>
  withSeededReplica((store) =>
    Effect.gen(function* () {
      const mutex = yield* Semaphore.make(1);
      const engine = yield* makeSyncEngine(store, mutex, unusedTransport);
      const error = yield* engine
        .saveCommand(
          lastUnitEnvelope({
            replicaId: LAST_UNIT_REPLICA_A,
            clientSequence: "2",
            command: lastUnitBuyerACommand,
          }),
          1,
        )
        .pipe(Effect.flip);
      expect(error._tag).toBe("SyncProtocolError");
      if (error._tag === "SyncProtocolError") {
        expect(error.code).toBe("REPLICA_SEQUENCE_GAP");
      }
    }),
  ),
);
