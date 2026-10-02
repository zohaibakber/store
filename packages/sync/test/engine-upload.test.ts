import { describe, expect, it } from "@effect/vitest";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction, type SqliteReplicaHandle } from "../src/replica/storage";
import { sqliteEngine, stubTransport } from "./lib/engine-fixture";
import { enqueueRequestOf } from "./lib/enqueue";
import { withSeededReplica } from "./lib/replica-fixture";

const saveFirstCommand = (handle: SqliteReplicaHandle) =>
  makeSqliteReplicaStore(handle, "sqlite").pipe(
    Effect.flatMap((store) => store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1))),
  );

const firstOutboxRow = (handle: SqliteReplicaHandle) =>
  runReplicaTransaction(handle, (tx) =>
    tx
      .select()
      .from(commandOutbox)
      .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
      .get(),
  );

describe("sync engine upload", () => {
  it.effect("returns an interrupted upload claim to pending with an uncertain outcome", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* saveFirstCommand(handle);
        const started = yield* Deferred.make<void>();
        const transport = stubTransport({
          submitCommand: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        });
        const engine = yield* sqliteEngine(handle, transport);
        const upload = yield* Effect.forkChild(engine.uploadOnce());
        yield* Deferred.await(started);
        yield* Fiber.interrupt(upload);
        const row = yield* firstOutboxRow(handle);
        expect(row?.status).toBe("pending");
        expect(row?.outcomeUncertain).toBe(true);
        expect(row?.claimId).toBeNull();
      }),
    ),
  );
});
