import { openNodeReplicaSqlite, type NodeReplicaSqlite } from "@store/client-db/node-sqlite";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { replicaLegacyPort } from "../../../src/lib/legacy-migration/browser";
import {
  legacyDatabaseName,
  legacySaleOutboxKey,
  type LegacyArchive,
  type LegacyDatabaseCapture,
  type LegacyMigrationReport,
  type LegacyMigrationState,
} from "../../../src/lib/legacy-migration/model";
import {
  LegacyMigrationFailure,
  runLegacyMigration,
  type LegacyFilesPort,
  type LegacyMigrationPorts,
  type LegacyReplicaPort,
  type LegacyStorePort,
} from "../../../src/lib/legacy-migration/run";
import {
  actor,
  API_BASE_URL,
  crudRows,
  identity,
  journal,
  legacyDatabase,
  ORGANIZATION_ID,
  seedServerReplica,
} from "./fixtures";

const databaseName = legacyDatabaseName(API_BASE_URL, ORGANIZATION_ID);
const saleOutboxKey = legacySaleOutboxKey(ORGANIZATION_ID);
const foreignEmpty = "powersync-inventory-00000000.sqlite";
const foreignBusy = "powersync-inventory-11111111.sqlite";

const failure = (step: string) => new LegacyMigrationFailure({ step, message: `${step} failed` });

type LegacyStoreOptions = {
  readonly capture?: LegacyDatabaseCapture;
  readonly journal?: string | null;
  readonly readFails?: boolean;
};

const makeLegacyStore = (options: LegacyStoreOptions = {}) => {
  const databases = new Map<string, LegacyDatabaseCapture>();
  if (options.capture) databases.set(databaseName, options.capture);
  databases.set(foreignEmpty, { name: foreignEmpty, crud: [], tables: {} });
  databases.set(foreignBusy, { name: foreignBusy, crud: crudRows.slice(0, 1), tables: {} });
  const storage = new Map<string, string>();
  const journalValue = options.journal === undefined ? JSON.stringify(journal) : options.journal;
  if (journalValue !== null) storage.set(saleOutboxKey, journalValue);
  const deleted: Array<string> = [];
  const removed: Array<string> = [];
  const port: LegacyStorePort = {
    listDatabases: Effect.sync(() => [...databases.keys()]),
    readDatabase: (name) =>
      options.readFails
        ? Effect.fail(failure("read-database"))
        : Effect.sync(() => databases.get(name)!),
    probeDatabase: (name) =>
      Effect.sync(() => ({ pendingWrites: databases.get(name)?.crud.length ?? 0, invoiceRows: 0 })),
    deleteDatabase: (name) =>
      Effect.sync(() => {
        deleted.push(name);
        databases.delete(name);
      }),
    readSaleOutbox: (key) => Effect.sync(() => storage.get(key) ?? null),
    removeSaleOutbox: (key) =>
      Effect.sync(() => {
        removed.push(key);
        storage.delete(key);
      }),
  };
  return { port, databases, storage, deleted, removed };
};

type FilesOptions = {
  readonly onState?: (state: LegacyMigrationState) => Promise<void>;
  readonly writeArchiveFails?: boolean;
};

const makeFiles = (options: FilesOptions = {}) => {
  const states = new Map<string, LegacyMigrationState>();
  const archives = new Map<string, LegacyArchive>();
  const reports: Array<LegacyMigrationReport> = [];
  const log: Array<string> = [];
  let deadFilePurges = 0;
  const port: LegacyFilesPort = {
    readState: (organizationId) => Effect.sync(() => states.get(organizationId) ?? null),
    writeState: (state) =>
      Effect.promise(async () => {
        states.set(state.organizationId, state);
        log.push(`state:${state.phase}`);
        await options.onState?.(state);
      }),
    writeArchive: (archive) =>
      options.writeArchiveFails
        ? Effect.fail(failure("write-archive"))
        : Effect.sync(() => {
            const file = `${archive.organizationId}-${archives.size + 1}.json`;
            archives.set(file, archive);
            log.push("archive");
            return file;
          }),
    readArchive: (file) => {
      const archive = archives.get(file);
      return archive ? Effect.succeed(archive) : Effect.fail(failure("read-archive"));
    },
    archiveExists: (file) => Effect.sync(() => archives.has(file)),
    writeReport: (report) =>
      Effect.sync(() => {
        reports.push(report);
        log.push(`report:${report.complete}`);
      }),
    purgeDeadFiles: Effect.sync(() => {
      deadFilePurges += 1;
      log.push("purge-dead-files");
      return [];
    }),
  };
  return { port, states, archives, reports, log, deadFilePurges: () => deadFilePurges };
};

const openServerReplica = async () => {
  const replica = await openNodeReplicaSqlite(identity);
  await seedServerReplica(replica);
  return replica;
};

const caughtUpPort = (replica: NodeReplicaSqlite): LegacyReplicaPort => ({
  ...replicaLegacyPort(
    { ...replica, readSyncProgress: async () => ({ sessionOpenedAt: 1, caughtUpAt: 2 }) },
    actor,
  ),
  wakes: Stream.empty,
});

const receipt = (operationId: string) =>
  JSON.stringify({
    operationId,
    replicaId: "replica-1",
    clientSequence: "1",
    payloadHash: "0".repeat(64),
    decision: "rejected",
    commitSequence: "9",
    result: { _tag: "rejected", code: "INSUFFICIENT_STOCK", message: "Not enough stock." },
  });

const settleOutbox = (replica: NodeReplicaSqlite) => async (state: LegacyMigrationState) => {
  if (state.phase !== "enqueued") return;
  await replica.query(`update command_outbox set status = 'integrated'`, []);
  await replica.query(
    `update command_outbox set status = 'rejected', receiptJson = ? where operationId = 'cmd-unsynced'`,
    [receipt("cmd-unsynced")],
  );
};

const ports = (input: {
  readonly legacy: LegacyStorePort;
  readonly files: LegacyFilesPort;
  readonly replica: LegacyReplicaPort;
  readonly notices?: Array<unknown>;
  readonly reports?: Array<string>;
}): LegacyMigrationPorts => ({
  identity,
  apiBaseUrl: API_BASE_URL,
  legacy: input.legacy,
  files: input.files,
  replica: input.replica,
  notify: (notice) => Effect.sync(() => input.notices?.push(notice)),
  report: (_cause, op) => Effect.sync(() => input.reports?.push(op)),
  pollInterval: 5,
});

describe("runLegacyMigration", () => {
  it("archives first, carries unsynced writes over, reports, then purges legacy stores", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const files = makeFiles({ onState: settleOutbox(replica) });
    const notices: Array<unknown> = [];

    const result = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica), notices }),
      ),
    );

    expect(result).toBe("purged");
    expect(files.log.slice(0, 2)).toEqual(["archive", "state:archived"]);
    const archive = [...files.archives.values()][0];
    expect(archive?.databases[0]?.crud).toEqual(crudRows);
    expect(archive?.saleOutbox).toEqual([{ key: saleOutboxKey, value: JSON.stringify(journal) }]);
    expect(await replica.readOutboxStatuses()).toHaveLength(6);

    const report = files.reports.at(-1);
    expect(report?.complete).toBe(true);
    expect(report?.counts).toEqual({
      carriedOver: 5,
      accepted: 5,
      rejected: 1,
      skipped: 3,
      notQueued: 0,
      undecodable: 0,
    });
    const rejected = report?.operations.find((operation) => operation.outcome === "rejected");
    expect(rejected).toMatchObject({
      operationId: "cmd-unsynced",
      kind: "sale",
      code: "INSUFFICIENT_STOCK",
      legacy: {
        invoiceId: "inv-unsynced",
        journal: journal["cmd-unsynced"],
        command: { commandId: "cmd-unsynced" },
      },
    });
    expect(notices).toEqual([{ carriedOver: 5, rejected: 1 }]);
    expect(legacy.deleted).toEqual([databaseName, foreignEmpty]);
    expect(legacy.removed).toEqual([saleOutboxKey]);
    expect(files.deadFilePurges()).toBe(1);
    expect(files.states.get(ORGANIZATION_ID)?.phase).toBe("purged");
    expect(files.archives.size).toBe(1);

    const again = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica), notices }),
      ),
    );
    expect(again).toBe("purged");
    expect(notices).toHaveLength(1);
    expect(await replica.readOutboxStatuses()).toHaveLength(6);
    replica.close();
  });

  it("resumes after a crash mid-enqueue without duplicating commands", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const files = makeFiles({ onState: settleOutbox(replica) });
    const healthy = caughtUpPort(replica);
    let calls = 0;
    const crashing: LegacyReplicaPort = {
      ...healthy,
      enqueue: (request) =>
        Effect.suspend(() => {
          calls += 1;
          return calls === 3 ? Effect.die(new Error("renderer crashed")) : healthy.enqueue(request);
        }),
    };

    const crashed = await Effect.runPromiseExit(
      runLegacyMigration(ports({ legacy: legacy.port, files: files.port, replica: crashing })),
    );
    expect(Exit.isFailure(crashed)).toBe(true);
    expect(files.states.get(ORGANIZATION_ID)?.phase).toBe("archived");
    expect(await replica.readOutboxStatuses()).toHaveLength(2);
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);
    expect(files.deadFilePurges()).toBe(0);

    const resumed = await Effect.runPromise(
      runLegacyMigration(ports({ legacy: legacy.port, files: files.port, replica: healthy })),
    );
    expect(resumed).toBe("purged");
    const outbox = await replica.query(
      `select operationId, count(*) as copies from command_outbox group by operationId`,
      [],
    );
    expect(outbox).toHaveLength(6);
    expect(outbox.every((row) => row["copies"] === 1)).toBe(true);
    expect(files.archives.size).toBe(1);
    const state = files.states.get(ORGANIZATION_ID);
    expect(state?.operations.filter((operation) => operation.outcome === "queued")).toHaveLength(6);
    replica.close();
  });

  it("resumes from the archive when the legacy stores are already gone", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const files = makeFiles();
    const stalled: LegacyReplicaPort = {
      ...caughtUpPort(replica),
      syncProgress: Effect.fail(failure("sync-progress")),
    };
    const first = await Effect.runPromiseExit(
      runLegacyMigration(ports({ legacy: legacy.port, files: files.port, replica: stalled })),
    );
    expect(Exit.isFailure(first)).toBe(true);
    legacy.databases.delete(databaseName);
    legacy.storage.clear();

    const settled = makeFiles({ onState: settleOutbox(replica) });
    for (const [key, value] of files.states) settled.states.set(key, value);
    for (const [key, value] of files.archives) settled.archives.set(key, value);
    const resumed = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: settled.port, replica: caughtUpPort(replica) }),
      ),
    );
    expect(resumed).toBe("purged");
    expect(await replica.readOutboxStatuses()).toHaveLength(6);
    expect(settled.reports.at(-1)?.counts.carriedOver).toBe(5);
    replica.close();
  });

  it("leaves every legacy store untouched when the legacy database cannot be read", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName), readFails: true });
    const files = makeFiles();
    const exit = await Effect.runPromiseExit(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica) }),
      ),
    );
    expect(exit).toMatchObject({ _tag: "Failure" });
    expect(files.archives.size).toBe(0);
    expect(files.states.size).toBe(0);
    expect(files.deadFilePurges()).toBe(0);
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);
    expect(legacy.storage.has(saleOutboxKey)).toBe(true);
    expect(await replica.readOutboxStatuses()).toEqual([]);
    replica.close();
  });

  it("enqueues nothing when the archive cannot be written", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const files = makeFiles({ writeArchiveFails: true });
    const exit = await Effect.runPromiseExit(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica) }),
      ),
    );
    expect(exit).toMatchObject({ _tag: "Failure" });
    expect(files.states.size).toBe(0);
    expect(await replica.readOutboxStatuses()).toEqual([]);
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);
    replica.close();
  });

  it("keeps the legacy stores when the archive disappears before the purge", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const settle = settleOutbox(replica);
    const files = makeFiles({
      onState: async (state) => {
        await settle(state);
        if (state.phase === "reported") files.archives.clear();
      },
    });
    const exit = await Effect.runPromiseExit(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica) }),
      ),
    );
    expect(exit).toMatchObject({ _tag: "Failure" });
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);
    expect(files.states.get(ORGANIZATION_ID)?.phase).toBe("reported");
    replica.close();
  });

  it("keeps retrying queued failures on later launches instead of purging", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ capture: legacyDatabase(databaseName) });
    const files = makeFiles();
    const reports: Array<string> = [];
    const healthy = caughtUpPort(replica);
    const failing: LegacyReplicaPort = {
      ...healthy,
      enqueue: (request) =>
        request.kind === "sale" ? Effect.fail(failure("enqueue")) : healthy.enqueue(request),
    };
    const result = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: failing, reports }),
      ),
    );
    expect(result).toBe("pending");
    expect(files.states.get(ORGANIZATION_ID)?.phase).toBe("enqueued");
    expect(files.reports.at(-1)).toMatchObject({ complete: false, counts: { notQueued: 1 } });
    expect(reports).toContain("legacy-migration-enqueue");
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);

    const settled = makeFiles({ onState: settleOutbox(replica) });
    for (const [key, value] of files.states) settled.states.set(key, value);
    for (const [key, value] of files.archives) settled.archives.set(key, value);
    const retried = await Effect.runPromise(
      runLegacyMigration(ports({ legacy: legacy.port, files: settled.port, replica: healthy })),
    );
    expect(retried).toBe("purged");
    expect(await replica.readOutboxStatuses()).toHaveLength(6);
    expect(settled.reports.at(-1)?.operations.map((operation) => operation.reason)).toEqual([
      "create",
      "create",
      "create",
      "patch",
      "patch",
      "rowMissing",
      "syncedByPreviousVersion",
      "alreadySynced",
      "unsynced",
    ]);
    replica.close();
  });

  it("does not purge while undecodable legacy entries remain", async () => {
    const replica = await openServerReplica();
    const capture = legacyDatabase(databaseName);
    const legacy = makeLegacyStore({
      capture: { ...capture, crud: [...capture.crud, { id: 50, tx_id: 50, data: "{broken" }] },
    });
    const files = makeFiles({ onState: settleOutbox(replica) });
    const reports: Array<string> = [];
    const result = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica), reports }),
      ),
    );
    expect(result).toBe("blocked");
    expect(reports).toContain("legacy-migration-undecodable");
    expect(files.reports.at(-1)?.undecodable).toHaveLength(1);
    expect(legacy.deleted).toEqual([]);
    expect(legacy.removed).toEqual([]);
    replica.close();
  });

  it("purges dead legacy files silently when there is no legacy data", async () => {
    const replica = await openServerReplica();
    const legacy = makeLegacyStore({ journal: null });
    const files = makeFiles();
    const result = await Effect.runPromise(
      runLegacyMigration(
        ports({ legacy: legacy.port, files: files.port, replica: caughtUpPort(replica) }),
      ),
    );
    expect(result).toBe("nothing");
    expect(files.deadFilePurges()).toBe(1);
    expect(files.archives.size).toBe(0);
    expect(legacy.deleted).toEqual([foreignEmpty]);
    replica.close();
  });
});
