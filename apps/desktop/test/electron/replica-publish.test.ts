import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commitPublish,
  makeImportClient,
  readPublishStatus,
  type ImportClient,
} from "@store/client-db/node-publish";
import { ImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  discardPublish,
  publishLocalWorkspace,
  type PublishPorts,
} from "../../electron/replica-publish";
import { readPublishMarker, writePublishMarker } from "../../electron/replica-publish-files";
import { ReplicaWorkerFailure, ReplicaWorkerRpcs } from "../../electron/replica-rpc";

const ORGANIZATION = "org-1";

const FIRST = ImportId.make("import-first");

const LATER = ImportId.make("import-later");

const DIGEST = "ab".repeat(32);

const CONFLICT = "This organization already has inventory.";

const API = "https://api.example.com";

const directories: Array<string> = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

type Server = {
  committed: ImportId | undefined;
  stocked: boolean;
  status: "answers" | "down" | "missing";
  commitReply: "delivered" | "lost";
  parts: number;
  imports: number;
};

type Device = {
  current: ImportId;
  stage: "completes" | "breaks";
  commit: "sends" | "breaks";
};

const answer = (status: number, bodyText: string) => new Response(bodyText, { status });

const refusal = (status: number, code: string, message: string) =>
  answer(status, JSON.stringify({ error: { code, message } }));

const resultOf = (importId: ImportId) => ({
  importId,
  horizon: "1",
  entityCounts: [],
  digest: DIGEST,
  digestVersion: 4,
});

const statusOf = (server: Server, importId: ImportId) => {
  if (server.committed === importId) {
    return { _tag: "committed" as const, result: resultOf(importId) };
  }
  return server.committed !== undefined || server.stocked
    ? { _tag: "other" as const, message: CONFLICT }
    : { _tag: "none" as const };
};

const organizationServer = (server: Server) =>
  HttpClient.make((request, url) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(server, request.method, url))),
  );

const respond = (server: Server, method: string, url: URL) => {
  {
    const [importId, step] = url.pathname.slice("/api/sync/imports/".length).split("/");
    const asked = ImportId.make(importId ?? "");
    const standing = statusOf(server, asked);
    if (method === "GET") {
      switch (server.status) {
        case "down":
          return answer(503, "");
        case "missing":
          return refusal(404, "NOT_FOUND", "Not found.");
        case "answers":
          return answer(200, JSON.stringify(standing));
      }
    }
    if (standing._tag === "other") return refusal(409, "ENTITY_CONFLICT", CONFLICT);
    if (step === "parts") {
      server.parts += 1;
      return answer(200, JSON.stringify({ partNumber: 1, byteLength: 2, sha256: DIGEST }));
    }
    if (standing._tag === "none") {
      server.committed = asked;
      server.imports += 1;
    }
    return server.commitReply === "lost"
      ? answer(503, "")
      : answer(200, JSON.stringify(resultOf(asked)));
  }
};

const stopped = () => new ReplicaWorkerFailure({ message: "The worker stopped." });

const scriptedWorker = (device: Device, imports: ImportClient) =>
  ReplicaWorkerRpcs.toLayer({
    Engine: () => Effect.die("unused"),
    AttachRenderer: () => Effect.void,
    Stamp: () => Effect.die("unused"),
    SetForeground: () => Effect.die("unused"),
    BackUp: () => Effect.die("unused"),
    StageRestore: () => Effect.die("unused"),
    ReleaseForRestore: () => Effect.die("unused"),
    PublishSummary: () =>
      Effect.succeed({
        importId: device.current,
        products: 3,
        sales: 2,
        purchaseOrders: 0,
        rows: 9,
        outstanding: 0,
      }),
    PublishStage: ({ importId }) =>
      Stream.fromEffect(
        imports.stagePart(importId, 1, "{}").pipe(
          Effect.mapError((failure) => new ReplicaWorkerFailure({ message: failure.message })),
          Effect.as({ _tag: "staged" as const, partNumber: 1, rowCount: 9 }),
        ),
      ).pipe(
        Stream.concat(
          device.stage === "breaks"
            ? Stream.fail(stopped())
            : Stream.make({
                _tag: "sealed" as const,
                partCount: 1,
                digest: DIGEST,
                digestVersion: 4,
              }),
        ),
      ),
    PublishCommit: ({ importId, seal }) =>
      device.commit === "breaks"
        ? Effect.fail(stopped())
        : commitPublish({ organizationId: ORGANIZATION, importId, seal, client: imports }),
    PublishStatus: ({ importId }) => readPublishStatus({ importId, client: imports }),
    Commits: () => Stream.die("unused"),
    SyncHealth: () => Stream.die("unused"),
    SetAccessToken: () => Effect.die("unused"),
  });

const move = (organizationId = ORGANIZATION) => {
  const folder = mkdtempSync(path.join(tmpdir(), "replica-publish-"));
  directories.push(folder);
  const databasePath = path.join(folder, "replica.sqlite");
  writeFileSync(databasePath, "");
  const server: Server = {
    committed: undefined,
    stocked: false,
    status: "answers",
    commitReply: "delivered",
    parts: 0,
    imports: 0,
  };
  const device: Device = { current: FIRST, stage: "completes", commit: "sends" };
  const handlers = scriptedWorker(device, makeImportClient(organizationServer(server), API));
  const withPorts = <A>(use: (ports: PublishPorts) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(
            Effect.provideContext(yield* Layer.build(handlers)),
          );
          return yield* use({
            organizationId,
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
  return {
    server,
    device,
    databasePath,
    publish: () => withPorts(publishLocalWorkspace),
    cancel: () => withPorts(discardPublish),
    record: (marker: { readonly organizationId: string; readonly importId: ImportId }) =>
      Effect.runPromise(writePublishMarker(databasePath, { ...marker, startedAt: 1 })),
    look: async () => ({
      kept: existsSync(databasePath),
      archived: readdirSync(folder).some((name) => name.includes(".published-")),
      marker: Option.getOrUndefined(await Effect.runPromise(readPublishMarker(databasePath)))
        ?.importId,
    }),
  };
};

const SET_ASIDE = { kept: false, archived: true, marker: undefined };

const interruptedWhileStaging = async () => {
  const moving = move();
  moving.device.stage = "breaks";
  expect(await moving.publish()).toMatchObject({ _tag: "failed" });
  moving.device.stage = "completes";
  expect(await moving.look()).toEqual({ kept: true, archived: false, marker: FIRST });
  return moving;
};

const committedWithoutHearing = async () => {
  const moving = move();
  moving.server.commitReply = "lost";
  expect(await moving.publish()).toMatchObject({ _tag: "failed" });
  moving.server.commitReply = "delivered";
  expect(moving.server.committed).toBe(FIRST);
  expect(await moving.look()).toEqual({ kept: true, archived: false, marker: FIRST });
  return moving;
};

describe("resuming a move to an organization", () => {
  it("stages again after stopping while parts were being sent", async () => {
    const moving = await interruptedWhileStaging();
    expect(await moving.publish()).toMatchObject({ _tag: "published" });
    expect(moving.server).toMatchObject({ committed: FIRST, imports: 1, parts: 2 });
    expect(await moving.look()).toEqual(SET_ASIDE);
  });

  it("stages again after stopping between the seal and the commit", async () => {
    const moving = move();
    moving.device.commit = "breaks";
    expect(await moving.publish()).toMatchObject({ _tag: "failed" });
    moving.device.commit = "sends";
    expect(moving.server.committed).toBeUndefined();
    expect(await moving.look()).toEqual({ kept: true, archived: false, marker: FIRST });

    expect(await moving.publish()).toMatchObject({ _tag: "published" });
    expect(moving.server).toMatchObject({ committed: FIRST, imports: 1, parts: 2 });
    expect(await moving.look()).toEqual(SET_ASIDE);
  });

  it("sets the file aside when the organization accepted it and the reply was lost", async () => {
    const moving = await committedWithoutHearing();
    expect(await moving.publish()).toMatchObject({ _tag: "published" });
    expect(moving.server).toMatchObject({ committed: FIRST, imports: 1, parts: 1 });
    expect(await moving.look()).toEqual(SET_ASIDE);
  });

  it("keeps a file that changed after the organization accepted it", async () => {
    const moving = await committedWithoutHearing();
    moving.device.current = LATER;
    expect(await moving.publish()).toEqual({
      _tag: "failed",
      message: expect.stringContaining("already moved"),
    });
    expect(moving.server).toMatchObject({ committed: FIRST, imports: 1, parts: 1 });
    expect(await moving.look()).toEqual({ kept: true, archived: false, marker: undefined });
  });

  it("gives up when the organization holds other inventory", async () => {
    const moving = await interruptedWhileStaging();
    moving.server.stocked = true;
    expect(await moving.publish()).toEqual({ _tag: "failed", message: CONFLICT });
    expect(moving.server).toMatchObject({ committed: undefined, imports: 0, parts: 1 });
    expect(await moving.look()).toEqual({ kept: true, archived: false, marker: undefined });
  });

  it.each(["down", "missing"] as const)(
    "waits when the status read is %s, then finishes once it answers",
    async (status) => {
      const moving = await committedWithoutHearing();
      moving.server.status = status;
      expect(await moving.publish()).toMatchObject({ _tag: "failed" });
      expect(moving.server).toMatchObject({ committed: FIRST, imports: 1, parts: 1 });
      expect(await moving.look()).toEqual({ kept: true, archived: false, marker: FIRST });

      moving.server.status = "answers";
      expect(await moving.publish()).toMatchObject({ _tag: "published" });
      expect(moving.server).toMatchObject({ imports: 1, parts: 1 });
      expect(await moving.look()).toEqual(SET_ASIDE);
    },
  );

  it("forgets the move once the file is gone", async () => {
    const moving = move();
    await moving.record({ organizationId: ORGANIZATION, importId: FIRST });
    rmSync(moving.databasePath);
    expect(await moving.publish()).toMatchObject({ _tag: "failed" });
    expect(moving.server).toMatchObject({ imports: 0, parts: 0 });
    expect(await moving.look()).toEqual({ kept: false, archived: false, marker: undefined });
  });

  it("refuses while another organization's move is pending, until it is cancelled", async () => {
    const moving = move();
    await moving.record({ organizationId: "org-2", importId: FIRST });
    expect(await moving.publish()).toEqual({
      _tag: "failed",
      message: expect.stringContaining("another organization"),
    });
    expect(moving.server).toMatchObject({ imports: 0, parts: 0 });
    expect(await moving.look()).toEqual({ kept: true, archived: false, marker: FIRST });

    await moving.cancel();
    expect(await moving.publish()).toMatchObject({ _tag: "published" });
    expect(moving.server).toMatchObject({ committed: FIRST, imports: 1 });
  });

  it("reads a marker written with a seal by an earlier build", async () => {
    const moving = move();
    writeFileSync(
      `${moving.databasePath}.publishing`,
      JSON.stringify({
        organizationId: ORGANIZATION,
        importId: FIRST,
        seal: { partCount: 1, digest: DIGEST, digestVersion: 3 },
        startedAt: 7,
      }),
    );
    expect(await Effect.runPromise(readPublishMarker(moving.databasePath))).toEqual(
      Option.some({ organizationId: ORGANIZATION, importId: FIRST, startedAt: 7 }),
    );
    moving.server.committed = FIRST;
    expect(await moving.publish()).toMatchObject({ _tag: "published" });
    expect(moving.server).toMatchObject({ imports: 0, parts: 0 });
    expect(await moving.look()).toEqual(SET_ASIDE);
  });
});
