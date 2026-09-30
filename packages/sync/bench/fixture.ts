import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { SyncCommandEnvelope } from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { replicaMigrations } from "@store/db/replica/migrations";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { runMigrations } from "../src/migrations";
import { encodeEnvelopeJson } from "../src/replica/codecs";
import {
  BASE_COMMIT_SEQUENCE,
  batchRow,
  categoryRow,
  EPOCH,
  GENERATOR_VERSION,
  INCARNATION,
  invoiceBundle,
  invoiceCommand,
  NOW,
  ORGANIZATION_ID,
  productRow,
  REPLICA_ID,
  countsFor,
  stockInMovement,
  totalRows,
  USER_ID,
  type FixtureCounts,
} from "./data";

const FIXTURE_ROOT = process.env["BENCH_FIXTURE_DIR"] ?? "/tmp/store-bench-fixtures";
const WORK_ROOT = process.env["BENCH_WORK_DIR"] ?? "/var/tmp/store-bench/work";

const FIXTURE_SCHEMA_KEYS = ["20260929032731_replica_baseline"];

const INSERT_BATCH_ROWS = 50_000;

type FixtureManifest = {
  readonly generatorVersion: number;
  readonly label: string;
  readonly counts: FixtureCounts;
  readonly rows: number;
  readonly bytes: number;
  readonly generatedAt: string;
  readonly generationSeconds: number;
  readonly migrations: ReadonlyArray<string>;
};

type FixtureHandle = {
  readonly label: string;
  readonly counts: FixtureCounts;
  readonly path: string;
  readonly manifest: FixtureManifest;
};

export const SIZES = {
  "10k": 10_000,
  "100k": 100_000,
} as const;

export type SizeLabel = keyof typeof SIZES;

const fixturePath = (label: string) => join(FIXTURE_ROOT, `replica-${label}.sqlite`);
const manifestPath = (label: string) => join(FIXTURE_ROOT, `replica-${label}.json`);

const migrate = (path: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient.make({ filename: path });
    const selected = Object.fromEntries(
      Object.entries(replicaMigrations).filter(([key]) => FIXTURE_SCHEMA_KEYS.includes(key)),
    );
    yield* runMigrations(sql, selected);
  }).pipe(Effect.provide(Reactivity.layer), Effect.scoped);

type ColumnValue = string | number | boolean | null;

const sqliteValue = (value: ColumnValue | undefined): string | number | null =>
  value === true ? 1 : value === false ? 0 : (value ?? null);

type Sink = (row: Readonly<Record<string, ColumnValue>>) => void;

type Bulk = {
  readonly sink: (table: string, columns: ReadonlyArray<string>) => Sink;
  readonly finish: () => void;
};

const makeBulk = (db: DatabaseSync): Bulk => {
  let pending = 0;
  db.exec("begin");
  return {
    sink: (table, columns) => {
      const statement: StatementSync = db.prepare(
        `insert into ${table} (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
      );
      return (row) => {
        statement.run(...columns.map((column) => sqliteValue(row[column])));
        pending += 1;
        if (pending >= INSERT_BATCH_ROWS) {
          db.exec("commit");
          db.exec("begin");
          pending = 0;
        }
      };
    },
    finish: () => {
      db.exec("commit");
    },
  };
};

const META = [
  "createdAt",
  "updatedAt",
  "organizationId",
  "createdByUserId",
  "updatedByUserId",
  "deviceId",
  "operationId",
  "rowVersion",
];

const COLUMNS = {
  categories: ["id", "name", "tracksPacks", ...META],
  products: [
    "id",
    "name",
    "categoryId",
    "aisle",
    "composition",
    "strength",
    "unitsPerPack",
    "purchasePrice",
    "retailPrice",
    "unitPrice",
    "visible",
    ...META,
  ],
  batches: ["id", "productId", "batchNumber", "expiresAt", "packQuantity", "unitQuantity", ...META],
  invoices: ["id", "invoiceNumber", "customerName", "total", ...META],
  invoice_items: [
    "id",
    "invoiceId",
    "productId",
    "batchId",
    "productName",
    "batchNumber",
    "quantity",
    "quantityType",
    "baseUnitQuantity",
    "salePrice",
    ...META,
  ],
  stock_movements: [
    "id",
    "productId",
    "batchId",
    "invoiceId",
    "type",
    "packDelta",
    "unitDelta",
    "note",
    "organizationId",
    "actorUserId",
    "deviceId",
    "operationId",
    "createdAt",
  ],
} as const;

const populate = (path: string, counts: FixtureCounts, log: (message: string) => void) => {
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = off");
  db.exec("pragma synchronous = off");
  db.exec("pragma cache_size = -262144");
  db.exec("pragma locking_mode = exclusive");
  db.prepare(
    `insert into replica_state (id, organizationId, userId, replicaId, epoch, incarnation, appliedCommitSequence, nextClientSequence, localCommitVersion, activeGeneration, caughtUpAt, registeredAt) values ('singleton', ?, ?, ?, ?, ?, ?, '1', 0, 1, ?, ?)`,
  ).run(
    ORGANIZATION_ID,
    USER_ID,
    REPLICA_ID,
    EPOCH,
    INCARNATION,
    String(BASE_COMMIT_SEQUENCE),
    NOW,
    NOW,
  );

  const bulk = makeBulk(db);
  const addCategory = bulk.sink("categories", COLUMNS.categories);
  for (let index = 0; index < counts.categories; index += 1) addCategory(categoryRow(index));

  const addProduct = bulk.sink("products", COLUMNS.products);
  for (let index = 0; index < counts.products; index += 1) addProduct(productRow(counts, index));
  log(`products ${counts.products}`);

  const addBatch = bulk.sink("batches", COLUMNS.batches);
  for (let index = 0; index < counts.batches; index += 1) addBatch(batchRow(index));
  log(`batches ${counts.batches}`);

  const addInvoice = bulk.sink("invoices", COLUMNS.invoices);
  const addItem = bulk.sink("invoice_items", COLUMNS.invoice_items);
  const addMovement = bulk.sink("stock_movements", COLUMNS.stock_movements);
  for (let index = 0; index < counts.invoices; index += 1) {
    const bundle = invoiceBundle(counts, index);
    addInvoice(bundle.invoice);
    for (const item of bundle.items) addItem(item);
    for (const movement of bundle.movements) addMovement(movement);
    if (index > 0 && index % 50_000 === 0) log(`invoices ${index}`);
  }
  for (let index = 0; index < counts.batches; index += 1) addMovement(stockInMovement(index));
  bulk.finish();

  db.exec("pragma journal_mode = wal");
  db.exec("pragma wal_checkpoint(truncate)");
  db.close();
};

const readManifest = (label: string): FixtureManifest | undefined => {
  try {
    const parsed: FixtureManifest = JSON.parse(readFileSync(manifestPath(label), "utf8"));
    return parsed.generatorVersion === GENERATOR_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const ensureFixture = async (
  label: SizeLabel,
  log: (message: string) => void = () => undefined,
): Promise<FixtureHandle> => {
  const path = fixturePath(label);
  const counts = countsFor(SIZES[label]);
  const cached = readManifest(label);
  if (cached && existsSync(path)) return { label, counts, path, manifest: cached };
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const partial = `${path}.partial`;
  removeDatabase(partial);
  const started = Date.now();
  log(`generating ${label} fixture`);
  await Effect.runPromise(migrate(partial));
  populate(partial, counts, log);
  renameSync(partial, path);
  const manifest: FixtureManifest = {
    generatorVersion: GENERATOR_VERSION,
    label,
    counts,
    rows: totalRows(counts),
    bytes: statSync(path).size,
    generatedAt: new Date().toISOString(),
    generationSeconds: (Date.now() - started) / 1000,
    migrations: FIXTURE_SCHEMA_KEYS,
  };
  writeFileSync(manifestPath(label), JSON.stringify(manifest, null, 2));
  return { label, counts, path, manifest };
};

export const workCopy = (fixture: FixtureHandle, name: string): string => {
  mkdirSync(WORK_ROOT, { recursive: true });
  const target = join(WORK_ROOT, `${fixture.label}-${name}.sqlite`);
  removeDatabase(target);
  try {
    execFileSync("cp", ["--reflink=auto", fixture.path, target]);
  } catch {
    copyFileSync(fixture.path, target);
  }
  return target;
};

export const removeDatabase = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
};

export const databaseFootprint = (path: string) => {
  const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
  return {
    dbBytes: size(path),
    walBytes: size(`${path}-wal`),
    shmBytes: size(`${path}-shm`),
  };
};

export const seedPendingOverlays = (path: string, count: number): void => {
  const db = new DatabaseSync(path);
  db.exec("begin");
  const outbox = db.prepare(
    `insert into command_outbox (operationId, status, envelopeJson, receiptJson, clientSequence, createdAt, attempts, outcomeUncertain) values (?, 'pending', '{}', null, ?, ?, 0, 0)`,
  );
  const overlay = db.prepare(
    `insert into stock_overlays (commandId, batchId, packDelta, unitDelta) values (?, ?, ?, ?)`,
  );
  for (let index = 0; index < count; index += 1) {
    const commandId = `seed-pending-${index}`;
    outbox.run(commandId, String(index + 1), NOW);
    overlay.run(commandId, batchRow(index * 7 + 1).id, -1, 0);
  }
  db.exec("commit");
  db.close();
};

const decodeEnvelope = Schema.decodeUnknownSync(SyncCommandEnvelope);

export const seedPendingOutbox = (path: string, counts: FixtureCounts, count: number): void => {
  const db = new DatabaseSync(path);
  db.exec("begin");
  const outbox = db.prepare(
    `insert into command_outbox (operationId, status, envelopeJson, receiptJson, clientSequence, createdAt, attempts, outcomeUncertain) values (?, 'pending', ?, null, ?, ?, 0, 0)`,
  );
  for (let index = 0; index < count; index += 1) {
    const operationId = `seed-outbox-${index}`;
    const occurredAt = NOW + index;
    const command = invoiceCommand(counts, index, operationId, occurredAt);
    const clientSequence = String(index + 1);
    const envelope = decodeEnvelope({
      organizationId: ORGANIZATION_ID,
      epoch: EPOCH,
      replicaId: REPLICA_ID,
      clientSequence,
      operationId,
      payloadHash: canonicalPayloadHash(command),
      command,
    });
    outbox.run(operationId, encodeEnvelopeJson(envelope), clientSequence, occurredAt);
  }
  db.prepare("update replica_state set nextClientSequence = ?").run(String(count + 1));
  db.exec("commit");
  db.close();
};
