import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import { ImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import {
  publishLocalWorkspace,
  readLocalCatalogStanding,
  readPublishOffer,
  type PublishPorts,
} from "../../electron/replica-publish";
import { readPublishMarker, writePublishMarker } from "../../electron/replica-publish-files";
import { ReplicaWorkerFailure } from "../../electron/replica-rpc";

const ORGANIZATION = "org-1";

const DIGEST = "ab".repeat(32);

const seal = { partCount: 1, digest: DIGEST, digestVersion: 3 };

const summary = (importId: string) => ({
  importId: ImportId.make(importId),
  products: 0,
  sales: 2,
  rows: 4,
  outstanding: 0,
});

const directory = () => mkdtempSync(path.join(tmpdir(), "replica-publish-"));

const databaseAt = (folder: string) => {
  const databasePath = path.join(folder, "replica.sqlite");
  writeFileSync(databasePath, "");
  return databasePath;
};

type CommitResult =
  | { readonly _tag: "committed" }
  | { readonly _tag: "refused"; readonly code: string; readonly message: string };

const portsFor = (
  databasePath: string,
  commit: (acceptChangedFile: boolean) => CommitResult,
  staged: { current: boolean },
): PublishPorts => {
  const client = {
    PublishSummary: () => Effect.succeed(summary("import-later")),
    PublishCommit: (request: { readonly acceptChangedFile: boolean }) =>
      Effect.succeed(commit(request.acceptChangedFile)),
    PublishStage: () => {
      staged.current = true;
      return Stream.empty;
    },
  };
  return {
    organizationId: ORGANIZATION,
    databasePath,
    progress: () => Effect.void,
    worker: (use) =>
      use(client).pipe(
        Effect.mapError((cause) => new ReplicaWorkerFailure({ message: cause.message })),
      ),
  };
};

const sealMarker = (databasePath: string) =>
  writePublishMarker(databasePath, {
    organizationId: ORGANIZATION,
    importId: ImportId.make("import-landed"),
    seal,
    startedAt: 1,
  });

describe("publish resume after the local file changes", () => {
  it("archives a sealed import the organization already accepted", async () => {
    const folder = directory();
    const databasePath = databaseAt(folder);
    const staged = { current: false };
    await Effect.runPromise(sealMarker(databasePath));

    const outcome = await Effect.runPromise(
      publishLocalWorkspace(
        portsFor(
          databasePath,
          (acceptChangedFile) =>
            acceptChangedFile
              ? { _tag: "committed" }
              : {
                  _tag: "refused",
                  code: "changed",
                  message: "This device's data changed while it was being read. Try again.",
                },
          staged,
        ),
      ),
    );

    expect(outcome).toEqual({ _tag: "published", counts: { products: 0, sales: 2 } });
    expect(staged.current).toBe(false);
    expect(existsSync(databasePath)).toBe(false);
    expect(readdirSync(folder).some((name) => name.includes(".published-"))).toBe(true);
    expect(Option.isNone(await Effect.runPromise(readPublishMarker(databasePath)))).toBe(true);
  });

  it("keeps the marker when the organization refuses the stored import", async () => {
    const folder = directory();
    const databasePath = databaseAt(folder);
    const staged = { current: false };
    await Effect.runPromise(sealMarker(databasePath));
    const conflict =
      "This organization already has inventory. A device's data can only be moved into an empty organization.";

    const outcome = await Effect.runPromise(
      publishLocalWorkspace(
        portsFor(
          databasePath,
          (acceptChangedFile) =>
            acceptChangedFile
              ? { _tag: "refused", code: "ENTITY_CONFLICT", message: conflict }
              : {
                  _tag: "refused",
                  code: "changed",
                  message: "This device's data changed while it was being read. Try again.",
                },
          staged,
        ),
      ),
    );

    expect(outcome).toEqual({ _tag: "failed", message: conflict });
    expect(staged.current).toBe(false);
    expect(existsSync(databasePath)).toBe(true);
    const marker = await Effect.runPromise(readPublishMarker(databasePath));
    expect(Option.isSome(marker) && marker.value.importId).toBe(ImportId.make("import-landed"));
  });

  it("stages again when the refusal is not a conflict with data already there", async () => {
    const folder = directory();
    const databasePath = databaseAt(folder);
    const staged = { current: false };
    await Effect.runPromise(sealMarker(databasePath));

    const outcome = await Effect.runPromise(
      publishLocalWorkspace(
        portsFor(
          databasePath,
          () => ({
            _tag: "refused",
            code: "INVALID_OPERATION",
            message: "The import is incomplete: 0 of 1 parts arrived.",
          }),
          staged,
        ),
      ),
    );

    expect(staged.current).toBe(true);
    expect(outcome).toEqual({
      _tag: "failed",
      message: "This device's data could not be read to the end. Try again.",
    });
  });

  it("offers a resume when later commits changed the import id and products are gone", async () => {
    const databasePath = databaseAt(directory());
    await Effect.runPromise(sealMarker(databasePath));
    const offer = await Effect.runPromise(
      readPublishOffer(portsFor(databasePath, () => ({ _tag: "committed" }), { current: false })),
    );
    expect(offer).toEqual({
      _tag: "available",
      counts: { products: 0, sales: 2 },
      resuming: true,
    });
    expect(Option.isSome(await Effect.runPromise(readPublishMarker(databasePath)))).toBe(true);
  });
});

describe("local catalog standing", () => {
  it("is empty when the replica file is missing", async () => {
    const standing = await Effect.runPromise(
      readLocalCatalogStanding(path.join(directory(), "missing.sqlite")),
    );
    expect(standing).toEqual({ _tag: "empty" });
  });

  it("stays unknown when the file cannot be read", async () => {
    const databasePath = databaseAt(directory());
    writeFileSync(databasePath, "not a replica");
    expect(await Effect.runPromise(readLocalCatalogStanding(databasePath))).toEqual({
      _tag: "unknown",
    });
  });

  it("is stocked from categories alone when no product rows remain", async () => {
    const databasePath = path.join(directory(), "replica.sqlite");
    const replica = await openNodeReplicaSqlite(
      { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
      databasePath,
    );
    await replica.query(
      `insert into categories (
        id, name, tracksPacks, createdAt, updatedAt, organizationId,
        createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
      ) values ('cat-1', 'General', 1, 1, 1, 'org-1', 'user-1', 'user-1', 'device-1', 'seed', 1)`,
      [],
    );
    await replica.close();

    expect(await Effect.runPromise(readLocalCatalogStanding(databasePath))).toEqual({
      _tag: "stocked",
    });
  });
});
