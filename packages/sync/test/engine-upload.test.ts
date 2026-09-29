import { describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence, type CommandReceipt, type SyncCommandEnvelope } from "@store/contracts";
import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerACommand,
  lastUnitBuyerBCommand,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { claimNextUpload, releaseUploadClaim, saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction, type SqliteReplicaHandle } from "../src/replica/storage";
import { sqliteEngine, stubTransport } from "./lib/engine-fixture";
import { invoicePayloadOf, withSeededReplica } from "./lib/replica-fixture";

const acceptedReceipt = (envelope: SyncCommandEnvelope, commitSequence = "1"): CommandReceipt => ({
  operationId: envelope.operationId,
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: envelope.clientSequence,
  payloadHash: envelope.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: {
    _tag: "issueInvoice",
    invoiceId: invoicePayloadOf(envelope).invoiceId,
    invoiceNumber: Number(envelope.clientSequence),
  },
});

const saveFirstCommand = (handle: SqliteReplicaHandle) =>
  runReplicaTransaction(handle, (tx) => saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1));

const firstOutboxRow = (handle: SqliteReplicaHandle) =>
  runReplicaTransaction(handle, (tx) =>
    tx
      .select()
      .from(commandOutbox)
      .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
      .get(),
  );

describe("sync engine upload", () => {
  it.effect("reports a replica sequence gap as a protocol error", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const engine = yield* sqliteEngine(handle, stubTransport());
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
        expect(error).toMatchObject({ _tag: "SyncProtocolError", code: "REPLICA_SEQUENCE_GAP" });
      }),
    ),
  );

  it.effect("releases the replica permit before the HTTP submit", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* saveFirstCommand(handle);
        let held = 0;
        let heldDuringHttp = true;
        const mutex = {
          withPermits:
            (permits: number) =>
            <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              Effect.acquireUseRelease(
                Effect.sync(() => {
                  held += permits;
                }),
                () => effect,
                () =>
                  Effect.sync(() => {
                    held -= permits;
                  }),
              ),
        };
        const transport = stubTransport({
          submitCommand: (envelope) =>
            Effect.sync(() => {
              heldDuringHttp = held > 0;
              return acceptedReceipt(envelope);
            }),
        });
        const engine = yield* sqliteEngine(handle, transport, mutex);
        yield* engine.uploadOnce();
        expect(heldDuringHttp).toBe(false);
        expect((yield* firstOutboxRow(handle))?.status).toBe("accepted_awaiting_integration");
      }),
    ),
  );

  it.effect("allows only one concurrent upload claim", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const secondEnvelope = lastUnitEnvelope({
          replicaId: LAST_UNIT_REPLICA_A,
          clientSequence: "2",
          command: { ...lastUnitBuyerBCommand, invoiceNumber: 2 },
        });
        yield* runReplicaTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            yield* saveLocalCommand(tx, secondEnvelope, 2);
          }),
        );
        const firstStarted = yield* Deferred.make<void>();
        const transport = stubTransport({
          submitCommand: (envelope) =>
            envelope.operationId === lastUnitBuyerAEnvelope.operationId
              ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.succeed(acceptedReceipt(envelope, "2")),
        });
        const engine = yield* sqliteEngine(handle, transport);
        const first = yield* Effect.forkChild(engine.uploadOnce());
        yield* Deferred.await(firstStarted);
        expect(yield* engine.uploadOnce()).toBeUndefined();
        const sending = yield* runReplicaTransaction(handle, (tx) =>
          tx.select().from(commandOutbox).where(eq(commandOutbox.status, "sending")).all(),
        );
        expect(sending.map((row) => row.operationId)).toEqual([lastUnitBuyerAEnvelope.operationId]);
        yield* Fiber.interrupt(first);
      }),
    ),
  );

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

  it.effect("holds an interrupt that lands between claiming a command and sending it", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* saveFirstCommand(handle);
        const inner = yield* Semaphore.make(1);
        const armed = yield* Ref.make(false);
        const claimed = yield* Deferred.make<void>();
        const proceed = yield* Deferred.make<void>();
        const mutex = {
          withPermits:
            (permits: number) =>
            <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              Effect.gen(function* () {
                const result = yield* inner.withPermits(permits)(effect);
                if (yield* Ref.getAndSet(armed, false)) {
                  yield* Deferred.succeed(claimed, undefined);
                  yield* Deferred.await(proceed);
                }
                return result;
              }),
        };
        const engine = yield* sqliteEngine(handle, stubTransport(), mutex);
        yield* Ref.set(armed, true);
        const upload = yield* Effect.forkChild(engine.uploadOnce());
        yield* Deferred.await(claimed);
        const duringClaim = yield* firstOutboxRow(handle);
        expect(duringClaim?.status).toBe("sending");
        expect(duringClaim?.claimId).not.toBeNull();
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(upload), {
          startImmediately: true,
        });
        yield* Deferred.succeed(proceed, undefined);
        yield* Fiber.join(interrupting);
        const row = yield* firstOutboxRow(handle);
        expect(row?.status).toBe("pending");
        expect(row?.claimId).toBeNull();
      }),
    ),
  );

  it.effect("looks up a receipt before retrying an uncertain command", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* runReplicaTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            const claimed = yield* claimNextUpload(tx, { claimId: "claim-1", claimedAt: 1 });
            if (!claimed) return yield* Effect.die("Expected an upload claim.");
            yield* releaseUploadClaim(tx, claimed.operationId, claimed.claimId);
          }),
        );
        const receipt = acceptedReceipt(lastUnitBuyerAEnvelope);
        let submitCalls = 0;
        const transport = stubTransport({
          getReceipt: () => Effect.succeed(receipt),
          submitCommand: () =>
            Effect.sync(() => {
              submitCalls += 1;
              return receipt;
            }),
        });
        const engine = yield* sqliteEngine(handle, transport);
        expect(yield* engine.uploadOnce()).toEqual(receipt);
        expect(submitCalls).toBe(0);
        expect((yield* firstOutboxRow(handle))?.status).toBe("accepted_awaiting_integration");
      }),
    ),
  );
});
