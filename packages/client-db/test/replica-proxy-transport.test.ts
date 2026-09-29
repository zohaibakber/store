import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncEpoch } from "@store/contracts";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import {
  dispositionFor,
  SYNC_REQUEST_TIMEOUT_MILLIS,
  SyncTransportOffline,
  SyncTransportUnavailable,
} from "@store/sync";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  makeProxySyncTransport,
  type SyncProxyRequest,
  type SyncProxyResponse,
} from "../src/replica/proxy-transport";

const pullRequest = {
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  afterCommitSequence: OrgCommitSequence.make("0"),
};

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));

const errorBody = (code: string) => JSON.stringify({ error: { code, message: "unavailable" } });

describe("proxied sync transport", () => {
  it("tells the proxy each operation's deadline", () =>
    run(
      Effect.gen(function* () {
        const requests: Array<SyncProxyRequest> = [];
        const transport = makeProxySyncTransport(async (request) => {
          requests.push(request);
          return { ok: false, status: 404, bodyText: "" };
        });
        yield* transport.getReceipt("operation-1");
        yield* Effect.flip(transport.pull(pullRequest));
        expect(requests.map((request) => [request.pathname, request.timeoutMillis])).toEqual([
          ["/api/sync/receipts/operation-1", SYNC_REQUEST_TIMEOUT_MILLIS.getReceipt],
          ["/api/sync/pull", SYNC_REQUEST_TIMEOUT_MILLIS.pull],
        ]);
      }),
    ));

  it("honours Retry-After ahead of the protocol code in the error body", () =>
    run(
      Effect.gen(function* () {
        const responses: ReadonlyArray<SyncProxyResponse> = [
          { ok: false, status: 409, bodyText: errorBody("SNAPSHOT_UNAVAILABLE"), retryAfter: "20" },
          { ok: false, status: 409, bodyText: errorBody("SNAPSHOT_REQUIRED") },
        ];
        let next = 0;
        const transport = makeProxySyncTransport(async () => responses[next++] ?? responses[1]!);
        const delayed = yield* Effect.flip(transport.pull(pullRequest));
        expect(delayed).toBeInstanceOf(SyncTransportUnavailable);
        expect(dispositionFor(delayed)).toEqual({ _tag: "retry", delayMillis: 20_000 });
        const typed = yield* Effect.flip(transport.pull(pullRequest));
        expect(typed).toMatchObject({ _tag: "SyncProtocolError", code: "SNAPSHOT_REQUIRED" });
      }),
    ));

  it("sends the pull cursor with a command and decodes the page on its receipt", () =>
    run(
      Effect.gen(function* () {
        const receipt = {
          operationId: lastUnitBuyerAEnvelope.operationId,
          replicaId: lastUnitBuyerAEnvelope.replicaId,
          clientSequence: lastUnitBuyerAEnvelope.clientSequence,
          payloadHash: lastUnitBuyerAEnvelope.payloadHash,
          decision: "rejected",
          commitSequence: "4",
          result: { _tag: "rejected", code: "INSUFFICIENT_STOCK", message: "Sold out." },
        };
        const page = {
          epoch: "1",
          incarnation: "incarnation-test",
          subscription: "operational",
          schemaVersion: 1,
          transactions: [
            {
              commitSequence: "4",
              operationId: lastUnitBuyerAEnvelope.operationId,
              decision: "rejected",
              changes: [],
            },
          ],
          nextCommitSequence: "4",
          horizon: "4",
          retentionFloor: "0",
        };
        const bodies: Array<string | null> = [];
        const answers = [{ ...receipt, page }];
        const transport = makeProxySyncTransport(async (request) => {
          bodies.push(request.bodyText);
          return { ok: true, status: 200, bodyText: JSON.stringify(answers[bodies.length - 1]) };
        });
        const request = {
          ...lastUnitBuyerAEnvelope,
          afterCommitSequence: OrgCommitSequence.make("3"),
          maxBytes: 262_144,
        };
        const withPage = yield* transport.submitCommand(request);
        expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
          afterCommitSequence: "3",
          maxBytes: 262_144,
        });
        expect(withPage.page?.horizon).toBe("4");
        expect(withPage.page?.transactions).toHaveLength(1);
      }),
    ));

  it("fails a command that the proxy never answers as offline at its deadline", () =>
    run(
      Effect.gen(function* () {
        const transport = makeProxySyncTransport(() => new Promise<SyncProxyResponse>(() => {}));
        const pending = yield* Effect.forkChild(
          Effect.flip(transport.registerReplica({ replicaId: "replica-1" })),
        );
        yield* TestClock.adjust(SYNC_REQUEST_TIMEOUT_MILLIS.registerReplica);
        expect(yield* Fiber.join(pending)).toBeInstanceOf(SyncTransportOffline);
      }),
    ));
});
