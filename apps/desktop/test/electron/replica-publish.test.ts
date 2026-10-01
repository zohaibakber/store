import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { afterEach, describe, expect, it } from "vitest";

import {
  publishLocalWorkspace,
  readLocalCatalog,
  type PublishPorts,
} from "../../electron/replica-publish";
import { readPublishMarker, writePublishMarker } from "../../electron/replica-publish-files";
import { ReplicaWorkerFailure, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import { makeReplicaWorkerHandlers } from "../../electron/replica-worker-handlers";

const ORGANIZATION = "org-1";

const SEALED = ImportId.make("import-sealed");

const CHANGED = {
  _tag: "refused" as const,
  code: "changed",
  message: "This device's data changed while it was being read. Try again.",
};

const directories: Array<string> = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const directory = () => {
  const folder = mkdtempSync(path.join(tmpdir(), "replica-publish-"));
  directories.push(folder);
  return folder;
};

const fileIn = (folder: string, contents: string) => {
  const databasePath = path.join(folder, "replica.sqlite");
  writeFileSync(databasePath, contents);
  return databasePath;
};

type Script = {
  readonly current: ImportId;
  readonly staged: { count: number };
};

const scriptedWorker = (script: Script) =>
  ReplicaWorkerRpcs.toLayer({
    Engine: () => Effect.die("unused"),
    Stamp: () => Effect.die("unused"),
    ReadInsights: () => Effect.die("unused"),
    ReadOutboxStatuses: () => Effect.die("unused"),
    ReadSyncActivity: () => Effect.die("unused"),
    EnqueueCommand: () => Effect.die("unused"),
    ReadCommandStatus: () => Effect.die("unused"),
    SetForeground: () => Effect.die("unused"),
    WakeSyncUpload: () => Effect.die("unused"),
    BackUp: () => Effect.die("unused"),
    StageRestore: () => Effect.die("unused"),
    ReleaseForRestore: () => Effect.die("unused"),
    PublishSummary: () =>
      Effect.succeed({
        importId: script.current,
        products: 3,
        sales: 2,
        purchaseOrders: 0,
        rows: 9,
        outstanding: 0,
      }),
    PublishStage: () =>
      Stream.sync(() => {
        script.staged.count += 1;
      }).pipe(Stream.drain),
    PublishCommit: ({ acceptChangedFile }) =>
      Effect.succeed(
        script.current === SEALED || acceptChangedFile ? { _tag: "committed" as const } : CHANGED,
      ),
    Commits: () => Stream.die("unused"),
    SyncHealth: () => Stream.die("unused"),
    ProxyRequests: () => Stream.die("unused"),
    ProxyRespond: () => Effect.die("unused"),
    AccessTokenRequests: () => Stream.die("unused"),
    AccessTokenRespond: () => Effect.die("unused"),
  });

const withWorker = <A>(
  handlers: Layer.Layer<Layer.Success<ReturnType<typeof scriptedWorker>>, unknown>,
  databasePath: string,
  use: (ports: PublishPorts) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(
          Effect.provideContext(yield* Layer.build(handlers)),
        );
        return yield* use({
          organizationId: ORGANIZATION,
          databasePath,
          progress: () => Effect.void,
          worker: (work) =>
            work(client).pipe(
              Effect.mapError((cause) => new ReplicaWorkerFailure({ message: cause.message })),
            ),
        });
      }),
    ),
  );

const resumeWith = async (current: ImportId) => {
  const folder = directory();
  const databasePath = fileIn(folder, "");
  const staged = { count: 0 };
  await Effect.runPromise(
    writePublishMarker(databasePath, {
      organizationId: ORGANIZATION,
      importId: SEALED,
      seal: { partCount: 1, digest: "ab".repeat(32), digestVersion: 3 },
      startedAt: 1,
    }),
  );
  const outcome = await withWorker(
    scriptedWorker({ current, staged }),
    databasePath,
    publishLocalWorkspace,
  );
  return {
    outcome,
    staged: staged.count,
    kept: existsSync(databasePath),
    archived: readdirSync(folder).some((name) => name.includes(".published-")),
    marker: await Effect.runPromise(readPublishMarker(databasePath)),
  };
};

describe("resuming a move the organization already accepted", () => {
  it("sets the file aside when it is unchanged since its seal", async () => {
    const resumed = await resumeWith(SEALED);
    expect(resumed.outcome).toEqual({
      _tag: "published",
      counts: { products: 3, sales: 2, purchaseOrders: 0 },
    });
    expect(resumed).toMatchObject({ staged: 0, kept: false, archived: true });
    expect(Option.isNone(resumed.marker)).toBe(true);
  });

  it("neither sets aside nor stages again a file that changed after its seal", async () => {
    const resumed = await resumeWith(ImportId.make("import-later"));
    expect(resumed.outcome._tag).toBe("failed");
    expect(resumed).toMatchObject({ staged: 0, kept: true, archived: false });
    expect(Option.isNone(resumed.marker)).toBe(true);
  });
});

describe("local catalog standing", () => {
  const standingOf = (databasePath: string) =>
    withWorker(
      makeReplicaWorkerHandlers(
        Effect.succeed({
          authority: "remote" as const,
          organizationId: ORGANIZATION,
          userId: "user-1",
          replicaId: "replica-1",
          databasePath: path.join(directory(), "organization.sqlite"),
          apiBaseUrl: "https://api.tabaaq.local",
        }),
        () => Promise.reject(new Error("unused")),
      ),
      databasePath,
      readLocalCatalog,
    );

  it("reads a missing file as empty and an unreadable one as unknown", async () => {
    expect(await standingOf(path.join(directory(), "replica.sqlite"))).toEqual({ _tag: "empty" });
    expect(await standingOf(fileIn(directory(), "not a replica"))).toEqual({ _tag: "unknown" });
  });
});
