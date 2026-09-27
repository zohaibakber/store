import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { afterEach, describe, expect, it } from "vitest";

import { ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import { makeReplicaWorkerHandlers } from "../../electron/replica-worker-handlers";

const directories: Array<string> = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const withWorker = <A, E>(
  use: (client: Effect.Success<ReturnType<typeof makeClient>>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handlers = yield* Layer.build(makeReplicaWorkerHandlers());
        return yield* use(yield* makeClient().pipe(Effect.provideContext(handlers)));
      }),
    ),
  );

const makeClient = () => RpcTest.makeClient(ReplicaWorkerRpcs);

const boot = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "replica-worker-"));
  directories.push(directory);
  return {
    organizationId: "org-1",
    userId: "user-1",
    replicaId: "replica-1",
    databasePath: path.join(directory, "replica.sqlite"),
    apiBaseUrl: "https://api.tabaaq.local",
  };
};

describe("replica worker handlers", () => {
  it("refuses reads before the replica is open", async () => {
    await expect(withWorker((client) => client.Stamp())).rejects.toMatchObject({
      _tag: "ReplicaWorkerFailure",
      message: "Replica worker is not booted.",
    });
  });

  it("lowers subset specs to SQL inside the worker and proxies sync through the parent", async () => {
    const result = await withWorker((client) =>
      Effect.gen(function* () {
        const engine = yield* client.Open(boot());
        const proxied = yield* client.ProxyRequests().pipe(Stream.take(1), Stream.runCollect);
        const [request] = proxied;
        if (request) {
          yield* client.ProxyRespond({
            requestId: request.requestId,
            result: { ok: false, status: 503, bodyText: "offline" },
          });
        }
        const read = yield* client.ReadSubset({
          spec: {
            source: "categories",
            orderBy: [{ column: "name", direction: "asc" }],
            limit: 5,
            offset: 0,
          },
        });
        const rejected = yield* client
          .ReadSubset({
            spec: {
              source: "categories",
              where: { _tag: "compare", column: "productId", op: "eq", value: "p-1" },
              orderBy: [],
              limit: 5,
              offset: 0,
            },
          })
          .pipe(Effect.flip);
        const allocation = yield* client.ReadCommandAllocation();
        return { engine, request, read, rejected, allocation };
      }),
    );
    expect(result.engine).toBe("sqlite");
    expect(result.request?.pathname.startsWith("/api/sync/")).toBe(true);
    expect(result.read.rows).toEqual([]);
    expect(result.read.stamp.localCommitVersion).toBeGreaterThanOrEqual(0);
    expect(result.rejected.message).toContain("column productId is not allowlisted");
    expect(result.allocation).toEqual({ epoch: "1", nextClientSequence: "1" });
  });

  it("streams a recovery-required scheduler halt from the owned session", async () => {
    const health = await withWorker((client) =>
      Effect.gen(function* () {
        yield* client.Open(boot());
        yield* client.ProxyRequests().pipe(
          Stream.mapEffect((request) =>
            client.ProxyRespond({
              requestId: request.requestId,
              result: {
                ok: false,
                status: 409,
                bodyText: JSON.stringify({
                  error: { code: "EPOCH_MISMATCH", message: "The authority epoch changed." },
                }),
              },
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        return yield* client.SyncHealth().pipe(
          Stream.filter((status) => status._tag !== "running"),
          Stream.take(1),
          Stream.runCollect,
        );
      }).pipe(Effect.scoped),
    );
    expect(health).toEqual([
      {
        _tag: "recoveryRequired",
        message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
      },
    ]);
  });
});
