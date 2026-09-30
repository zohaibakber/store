import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import { SnapshotManifest, SyncPullResult, type SnapshotPartPayload } from "@store/contracts";
import * as Schema from "effect/Schema";

import type { InventorySubsetSpec, SubsetPredicate } from "../../client-db/src/replica/subset-spec";
import { GENERATION_TABLES, standbyTable } from "../src/replica/sqlite/generation";
import { sqlProbe, type BenchReplica } from "./adapter";
import {
  BASE_COMMIT_SEQUENCE,
  catalogCommand,
  DAY_MILLIS,
  EPOCH,
  INCARNATION,
  invoiceCommand,
  invoicePageOffset,
  movementPageOffset,
  NOW,
  productPageIndexes,
  remoteGroup,
  remotePage,
  remotePageChanges,
  searchProbes,
  snapshotRows,
  totalRows,
  type FixtureCounts,
} from "./data";
import { seedPendingOutbox, seedPendingOverlays, type SizeLabel } from "./fixture";
import type { ScenarioExtra } from "./report";
import { summarize } from "./stats";

const PAGE_SIZE = 50;
const SEARCH_LIMIT = 50;
const SEARCH_CANDIDATE_MULTIPLIER = 4;
const SEARCH_CANDIDATE_CAP = 500;
const PART_ROWS = 500;

type ScenarioContext = {
  readonly replica: BenchReplica;
  readonly counts: FixtureCounts;
  readonly label: SizeLabel;
  readonly log: (message: string) => void;
};

type Iteration = {
  readonly rows?: number;
  readonly phases?: Readonly<Record<string, number>>;
};

type Runner = {
  readonly run: (index: number) => Promise<Iteration>;
  readonly extra?: () => ScenarioExtra;
};

type Scenario = {
  readonly id: string;
  readonly title: string;
  readonly mutates: boolean;
  readonly reps: (label: SizeLabel) => { readonly warmup: number; readonly measured: number };
  readonly prepare?: (path: string, counts: FixtureCounts) => void;
  readonly start: (context: ScenarioContext) => Promise<Runner>;
};

const standard = () => ({ warmup: 5, measured: 30 });
const heavy = () => ({ warmup: 2, measured: 20 });
const perCommand = (label: SizeLabel) =>
  label === "100k" ? { warmup: 2, measured: 20 } : { warmup: 5, measured: 30 };

const productPageSpec = (pageIndex: number): InventorySubsetSpec => ({
  source: "products",
  orderBy: [
    { column: "name", direction: "asc" },
    { column: "id", direction: "asc" },
  ],
  limit: PAGE_SIZE,
  offset: pageIndex * PAGE_SIZE,
});

const isIdentifiedRow = Schema.is(Schema.Struct({ id: Schema.String }));

const idsOf = (rows: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  rows.filter(isIdentifiedRow).map((row) => row.id);

const containsToken = (token: string): SubsetPredicate => ({
  _tag: "or",
  predicates: ["name", "composition", "strength"].map((column) => ({
    _tag: "like",
    column,
    pattern: `%${token}%`,
  })),
});

const searchSpecs = (query: string): ReadonlyArray<InventorySubsetSpec> => {
  const tokens = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((token) => token !== "");
  return [
    {
      source: "products",
      where: { _tag: "like", column: "name", pattern: `${tokens.join(" ")}%` },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: SEARCH_LIMIT,
      offset: 0,
    },
    {
      source: "products",
      where: { _tag: "and", predicates: tokens.map(containsToken) },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: Math.min(SEARCH_CANDIDATE_CAP, SEARCH_LIMIT * SEARCH_CANDIDATE_MULTIPLIER),
      offset: 0,
    },
  ];
};

const productPage: Scenario = {
  id: "product-page",
  title: "Product page read (name order, 50 rows, pages 0..last)",
  mutates: false,
  reps: standard,
  start: async ({ replica, counts }) => {
    const pages = productPageIndexes(counts, PAGE_SIZE);
    return {
      run: async (index) => {
        const read = await replica.readSubset(productPageSpec(pages[index % pages.length] ?? 0));
        return { rows: read.rows.length };
      },
    };
  },
};

const pageProductIds = async ({
  replica,
  counts,
}: ScenarioContext): Promise<ReadonlyArray<string>> => {
  const ids: Array<string> = [];
  for (const pageIndex of productPageIndexes(counts, PAGE_SIZE)) {
    ids.push(...idsOf((await replica.readSubset(productPageSpec(pageIndex))).rows));
  }
  return ids;
};

const batchesOfPageRunner = async (context: ScenarioContext): Promise<Runner> => {
  const ids = await pageProductIds(context);
  const pageCount = Math.max(1, Math.floor(ids.length / PAGE_SIZE));
  return {
    run: async (index) => {
      const start = (index % pageCount) * PAGE_SIZE;
      const read = await context.replica.readSubset({
        source: "batches",
        where: { _tag: "in", column: "productId", values: ids.slice(start, start + PAGE_SIZE) },
        orderBy: [{ column: "id", direction: "asc" }],
        limit: 500,
        offset: 0,
      });
      return { rows: read.rows.length };
    },
  };
};

const productBatches: Scenario = {
  id: "product-page-batches",
  title: "Batches of one product page (visible stock, 50 products)",
  mutates: false,
  reps: standard,
  start: batchesOfPageRunner,
};

const productBatchesPending: Scenario = {
  id: "product-page-batches-pending",
  title: "Batches of one product page with 30 pending stock overlays",
  mutates: true,
  reps: standard,
  prepare: (path) => seedPendingOverlays(path, 30),
  start: batchesOfPageRunner,
};

const productSummary: Scenario = {
  id: "product-summary",
  title: "Product count + facet distinct values (5 columns, unfiltered)",
  mutates: false,
  reps: heavy,
  start: async ({ replica }) => ({
    run: async () => {
      const summary = await replica.summarizeSubset({
        source: "products",
        distinct: ["categoryId", "name", "aisle", "composition", "strength"],
      });
      return { rows: summary.count + summary.distinctValues };
    },
  }),
};

const productSearch: Scenario = {
  id: "product-search",
  title: "Product search (prefix + contains-token specs, mixed probes)",
  mutates: false,
  reps: standard,
  start: async ({ replica, counts }) => {
    const probes = searchProbes(counts);
    return {
      run: async (index) => {
        const probe = probes[index % probes.length];
        if (!probe) return { rows: 0 };
        let rows = 0;
        for (const spec of searchSpecs(probe.query)) {
          rows += (await replica.readSubset(spec)).rows.length;
        }
        return { rows };
      },
    };
  },
};

const deepInvoicePage = (counts: FixtureCounts, block: number): InventorySubsetSpec => ({
  source: "invoices",
  orderBy: [{ column: "createdAt", direction: "desc" }],
  limit: PAGE_SIZE,
  offset: invoicePageOffset(counts, PAGE_SIZE) + (block % 5) * PAGE_SIZE,
});

const isCreatedRow = Schema.is(Schema.Struct({ id: Schema.String, createdAt: Schema.Number }));

const createdAtOf = (rows: ReadonlyArray<unknown>): ReadonlyArray<number> =>
  rows.filter(isCreatedRow).map((row) => row.createdAt);

const keysetPage = (
  source: "invoices" | "stockMovements",
  scope: SubsetPredicate | undefined,
  before: number | undefined,
  limit: number,
): InventorySubsetSpec => {
  const cursor: SubsetPredicate | undefined =
    before === undefined
      ? undefined
      : { _tag: "compare", column: "createdAt", op: "lt", value: before };
  const predicates = [scope, cursor].filter((predicate) => predicate !== undefined);
  return Object.assign(
    { source, orderBy: [{ column: "createdAt", direction: "desc" as const }], limit, offset: 0 },
    predicates.length === 0
      ? undefined
      : { where: predicates.length === 1 ? predicates[0] : { _tag: "and" as const, predicates } },
  );
};

const boundaryTies = (
  source: "invoices" | "stockMovements",
  scope: SubsetPredicate | undefined,
  at: number,
): InventorySubsetSpec => {
  const tie: SubsetPredicate = { _tag: "compare", column: "createdAt", op: "eq", value: at };
  return {
    source,
    where: scope ? { _tag: "and", predicates: [scope, tie] } : tie,
    orderBy: [{ column: "id", direction: "asc" }],
    limit: 500,
    offset: 0,
  };
};

const pageTurn = async (
  replica: BenchReplica,
  source: "invoices" | "stockMovements",
  scope: SubsetPredicate | undefined,
  before: number | undefined,
) => {
  const page = await replica.readSubset(keysetPage(source, scope, before, PAGE_SIZE));
  const last = createdAtOf(page.rows).at(-1);
  const ties =
    last === undefined
      ? 0
      : (await replica.readSubset(boundaryTies(source, scope, last))).rows.length;
  return page.rows.length + ties;
};

const deepInvoices: Scenario = {
  id: "deep-history-invoices",
  title: "Invoice history keyset page turn at 80% depth (createdAt < cursor, 50 rows + ties)",
  mutates: false,
  reps: heavy,
  start: async ({ replica, counts }) => {
    const cursors: Array<number> = [];
    for (let block = 0; block < 5; block += 1) {
      const first = createdAtOf((await replica.readSubset(deepInvoicePage(counts, block))).rows)[0];
      if (first !== undefined) cursors.push(first);
    }
    return {
      run: async (index) => ({
        rows: await pageTurn(replica, "invoices", undefined, cursors[index % cursors.length]),
      }),
    };
  },
};

const deepInvoiceItems: Scenario = {
  id: "deep-history-invoice-items",
  title: "Line items of one deep invoice page (invoiceId in 50 ids)",
  mutates: false,
  reps: heavy,
  start: async ({ replica, counts }) => {
    const pages: Array<ReadonlyArray<string>> = [];
    for (let block = 0; block < 5; block += 1) {
      pages.push(idsOf((await replica.readSubset(deepInvoicePage(counts, block))).rows));
    }
    return {
      run: async (index) => {
        const read = await replica.readSubset({
          source: "invoiceItems",
          where: { _tag: "in", column: "invoiceId", values: pages[index % 5] ?? [] },
          orderBy: [{ column: "id", direction: "asc" }],
          limit: 500,
          offset: 0,
        });
        return { rows: read.rows.length };
      },
    };
  },
};

const isProductMovement = Schema.is(Schema.Struct({ productId: Schema.String }));

const deepMovements: Scenario = {
  id: "deep-history-movements",
  title:
    "Product stock movement history: first page + keyset page turn (productId, createdAt desc)",
  mutates: false,
  reps: heavy,
  start: async ({ replica, counts }) => {
    const deep = await replica.readSubset({
      source: "stockMovements",
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 5,
      offset: movementPageOffset(counts, PAGE_SIZE),
    });
    const products = deep.rows.filter(isProductMovement).map((row) => row.productId);
    return {
      run: async (index) => {
        const productId = products[index % products.length] ?? "";
        const scope: SubsetPredicate = {
          _tag: "compare",
          column: "productId",
          op: "eq",
          value: productId,
        };
        const first = await replica.readSubset(
          keysetPage("stockMovements", scope, undefined, PAGE_SIZE + 1),
        );
        const middle = createdAtOf(first.rows)[Math.floor(first.rows.length / 2)];
        const turned = await pageTurn(replica, "stockMovements", scope, middle);
        return { rows: first.rows.length + turned };
      },
    };
  },
};

const insightsFacts: Scenario = {
  id: "insights-facts",
  title: "Insights facts read (365-day window)",
  mutates: false,
  reps: heavy,
  start: async ({ replica }) => {
    let truncated = false;
    return {
      run: async () => {
        const read = await replica.readInsights({
          since: NOW - 365 * DAY_MILLIS,
          until: NOW,
          utcOffsetMinutes: 0,
        });
        truncated = read.truncated;
        return { rows: read.rows };
      },
      extra: () => ({ truncated }),
    };
  },
};

const digest: Scenario = {
  id: "digest",
  title: "Partition digest computation over the full replica",
  mutates: false,
  reps: heavy,
  start: async ({ replica }) => ({
    run: async () => {
      const report = await replica.computeDigest();
      return { rows: report?.count ?? 0 };
    },
  }),
};

const enqueueInvoice: Scenario = {
  id: "enqueue-invoice",
  title: "Local invoice enqueue (3 allocations)",
  mutates: true,
  reps: perCommand,
  start: async ({ replica, counts }) => ({
    run: async (index) => {
      const operationId = `bench-invoice-${index}`;
      const occurredAt = NOW + index * 1_000;
      await replica.enqueue({
        operationId,
        occurredAt,
        command: invoiceCommand(counts, index, operationId, occurredAt),
      });
      return {};
    },
  }),
};

const enqueueCatalog: Scenario = {
  id: "enqueue-catalog",
  title: "Catalog write enqueue (1 product update + 1 new batch)",
  mutates: true,
  reps: perCommand,
  start: async ({ replica, counts }) => ({
    run: async (index) => {
      const operationId = `bench-catalog-${index}`;
      const occurredAt = NOW + index * 1_000;
      await replica.enqueue({
        operationId,
        occurredAt,
        command: catalogCommand(counts, index, operationId, occurredAt),
      });
      return {};
    },
  }),
};

const remotePageApply: Scenario = {
  id: "remote-page-apply",
  title: "Remote page apply (100 invoice groups + categories, ~1000 changes)",
  mutates: true,
  reps: (label) => (label === "100k" ? { warmup: 1, measured: 5 } : { warmup: 3, measured: 20 }),
  start: async ({ replica, counts }) => {
    let appliedThrough = Number(await replica.readAppliedCommitSequence());
    return {
      run: async (index) => {
        const page = remotePage(counts, index, appliedThrough);
        const applied = await replica.applyRemotePage(page);
        appliedThrough = Number(applied.appliedThrough);
        return { rows: remotePageChanges(page) };
      },
    };
  },
};

const remoteGroupApply: Scenario = {
  id: "remote-group-apply",
  title: "Live single transaction group apply (1 invoice, 10 changes)",
  mutates: true,
  reps: standard,
  start: async ({ replica, counts }) => {
    let appliedThrough = Number(await replica.readAppliedCommitSequence());
    return {
      run: async (index) => {
        appliedThrough += 1;
        const group = remoteGroup(counts, 500_000 + index, 0, appliedThrough);
        await replica.applyTransactionGroup(group);
        return { rows: 10 };
      },
    };
  },
};

const decodeManifest = Schema.decodeUnknownSync(SnapshotManifest);

const snapshotManifest = (counts: FixtureCounts, snapshotId: string, horizon: number) =>
  decodeManifest({
    snapshotId,
    epoch: EPOCH,
    subscription: "operational",
    schemaVersion: 1,
    horizon: String(horizon),
    parts: Array.from({ length: Math.ceil(totalRows(counts) / PART_ROWS) }, (_, index) => ({
      partNumber: index + 1,
      byteLength: 0,
      sha256: "0".repeat(64),
    })),
    entityCounts: [
      { entity: "category", rowCount: counts.categories },
      { entity: "product", rowCount: counts.products },
      { entity: "batch", rowCount: counts.batches },
      { entity: "invoice", rowCount: counts.invoices },
      { entity: "invoiceItem", rowCount: counts.invoiceItems },
      { entity: "stockMovement", rowCount: counts.stockMovements },
    ],
    digestVersion: 3,
  });

const SNAPSHOT_PENDING_COMMANDS = 3;

const snapshotImport: Scenario = {
  id: "snapshot-import",
  title: "Snapshot import + promotion over an existing replica (3 pending commands)",
  mutates: true,
  reps: (label) => (label === "10k" ? { warmup: 0, measured: 3 } : { warmup: 0, measured: 1 }),
  start: async ({ replica, counts, log }) => {
    for (let index = 0; index < SNAPSHOT_PENDING_COMMANDS; index += 1) {
      const operationId = `bench-snapshot-pending-${index}`;
      const occurredAt = NOW + index * 1_000;
      await replica.enqueue({
        operationId,
        occurredAt,
        command: invoiceCommand(counts, index, operationId, occurredAt),
      });
    }
    log(`seeded ${SNAPSHOT_PENDING_COMMANDS} pending commands`);
    return {
      run: async (index) => {
        const manifest = snapshotManifest(
          counts,
          `bench-snapshot-${index}`,
          BASE_COMMIT_SEQUENCE + 10 + index,
        );
        let stageMs = 0;
        let started = performance.now();
        await replica.beginSnapshotImport(manifest);
        stageMs += performance.now() - started;
        let partNumber = 0;
        let buffer: Array<SnapshotPartPayload["rows"][number]> = [];
        const flush = async () => {
          partNumber += 1;
          const part: SnapshotPartPayload = {
            snapshotId: manifest.snapshotId,
            partNumber,
            rows: buffer,
          };
          buffer = [];
          started = performance.now();
          await replica.importSnapshotPart(manifest, part);
          stageMs += performance.now() - started;
          if (partNumber % 1_000 === 0) log(`snapshot part ${partNumber}/${manifest.parts.length}`);
        };
        for (const row of snapshotRows(counts)) {
          buffer.push(row);
          if (buffer.length === PART_ROWS) await flush();
        }
        if (buffer.length > 0) await flush();
        started = performance.now();
        await replica.activateSnapshot(manifest);
        const activateMs = performance.now() - started;
        return {
          rows: totalRows(counts),
          phases: {
            stageMs,
            activateMs,
            rowsPerSecondStaged: (totalRows(counts) / stageMs) * 1000,
          },
        };
      },
    };
  },
};

const pendingOutboxCount = (counts: FixtureCounts) => Math.round(counts.products / 2);

const claimUpload: Scenario = {
  id: "claim-upload",
  title: "Claim next upload + release (pending outbox = products / 2)",
  mutates: true,
  reps: standard,
  prepare: (path, counts) => seedPendingOutbox(path, counts, pendingOutboxCount(counts)),
  start: async ({ replica }) => ({
    run: async (index) => {
      const claimId = `bench-claim-${index}`;
      const started = performance.now();
      const claim = await replica.claimNextUpload(claimId, NOW + index);
      const claimMs = performance.now() - started;
      if (claim) await replica.releaseUploadClaim(claim.operationId, claimId);
      return { rows: claim ? 1 : 0, phases: { claimMs } };
    },
  }),
};

const RETIRE_STANDBY = [
  ...GENERATION_TABLES.map((table) => `insert into ${standbyTable(table)} select * from ${table}`),
  "update generation_state set standby = 'retired'",
];

const CLEANUP_POLL_MILLIS = 50;

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

const generationCleanup = (id: string, pattern: SalePattern): Scenario => ({
  id,
  title: `Retired generation cleanup with bursts of ${pattern.burst} invoice enqueues every ${pattern.gapMillis} ms, ${pattern.pauseMillis} ms apart`,
  mutates: true,
  reps: (label) => (label === "10k" ? { warmup: 0, measured: 3 } : { warmup: 0, measured: 1 }),
  start: async ({ replica, counts, log }) => {
    const sales: Array<number> = [];
    const loopDelay = monitorEventLoopDelay({ resolution: 10 });
    let refused = 0;
    let sequence = 0;
    return {
      run: async () => {
        let started = performance.now();
        await replica.execute(RETIRE_STANDBY);
        const seedMs = performance.now() - started;
        log(`retired set seeded in ${Math.round(seedMs)} ms`);
        replica.spans.reset();
        sqlProbe.reset();
        loopDelay.enable();
        loopDelay.reset();
        started = performance.now();
        await replica.requestCleanup();
        const seller = startSelling(replica, counts, "bench-cleanup-sale", sequence, pattern);
        while ((await replica.standbyState()) !== "empty") await sleep(CLEANUP_POLL_MILLIS);
        const cleanupMs = performance.now() - started;
        await seller.stop();
        loopDelay.disable();
        sales.push(...seller.sales);
        refused += seller.refused();
        sequence += seller.sales.length;
        log(`cleanup ${Math.round(cleanupMs)} ms, ${seller.sales.length} sales`);
        return { rows: totalRows(counts), phases: { seedMs, cleanupMs } };
      },
      extra: () => stallReport(sales, refused, loopDelay, replica),
    };
  },
});

type SalePattern = {
  readonly gapMillis: number;
  readonly burst: number;
  readonly pauseMillis: number;
};

const STEADY_SALES: SalePattern = { gapMillis: 100, burst: 1, pauseMillis: 100 };

const startSelling = (
  replica: BenchReplica,
  counts: FixtureCounts,
  prefix: string,
  firstSequence: number,
  pattern: SalePattern,
) => {
  const sales: Array<number> = [];
  let selling = true;
  let refused = 0;
  let sequence = firstSequence;
  const loop = (async () => {
    let due = performance.now();
    while (selling) {
      const operationId = `${prefix}-${sequence}`;
      const occurredAt = NOW + sequence * 1_000;
      await replica
        .enqueue({
          operationId,
          occurredAt,
          command: invoiceCommand(counts, sequence, operationId, occurredAt),
        })
        .then(
          () => undefined,
          () => {
            refused += 1;
          },
        );
      const finished = performance.now();
      sales.push(finished - due);
      sequence += 1;
      const gap =
        (sequence - firstSequence) % pattern.burst === 0 ? pattern.pauseMillis : pattern.gapMillis;
      due = finished + gap;
      await sleep(gap);
    }
  })();
  return {
    sales,
    refused: () => refused,
    stop: async () => {
      selling = false;
      await loop;
    },
  };
};

const stallReport = (
  sales: ReadonlyArray<number>,
  refused: number,
  loopDelay: ReturnType<typeof monitorEventLoopDelay>,
  replica: BenchReplica,
): ScenarioExtra => {
  const summary = summarize(sales);
  const byName = replica.spans.maxByName();
  const background = [...byName]
    .filter(([name]) => !name.startsWith("sql.") && !name.includes("enqueue"))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, millis]) => `${name}=${Math.round(millis)}`)
    .join(" ");
  const described = (entries: ReadonlyArray<{ readonly sql: string; readonly millis: number }>) =>
    entries
      .slice(0, 6)
      .map((entry) => `${Math.round(entry.millis)}ms ${entry.sql}`)
      .join(" | ");
  const totals = [...replica.spans.totalByName()]
    .filter(([name]) => name.startsWith("SqliteReplicaStore."))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name, millis]) => `${name.slice("SqliteReplicaStore.".length)}=${Math.round(millis)}`)
    .join(" ");
  return {
    sales: summary.count,
    refused,
    totalSpanMs: totals,
    saleP50Ms: summary.p50,
    saleP95Ms: summary.p95,
    saleP99Ms: summary.p99,
    saleMaxMs: summary.max,
    loopDelayMaxMs: loopDelay.max / 1e6,
    maxSpanMs: background,
    maxWriteHoldMs: sqlProbe.longestHolds()[0]?.millis ?? 0,
    longestHolds: described(sqlProbe.longestHolds()),
    slowStatements: described(sqlProbe.slowCalls()),
  };
};

const digestPage = async (replica: BenchReplica) => {
  const report = await replica.digestReport();
  if (report === undefined) throw new Error("The bench replica has pending rows.");
  const appliedThrough = await replica.readAppliedCommitSequence();
  return decodeDigestPage({
    epoch: EPOCH,
    incarnation: INCARNATION,
    subscription: "operational",
    schemaVersion: 1,
    transactions: [],
    nextCommitSequence: appliedThrough,
    horizon: appliedThrough,
    retentionFloor: "0",
    digest: report,
  });
};

const decodeDigestPage = Schema.decodeUnknownSync(SyncPullResult);

const digestVerify: Scenario = {
  id: "digest-verify",
  title: "Remote page apply carrying a matching v3 digest (idle replica)",
  mutates: true,
  reps: heavy,
  start: async ({ replica }) => {
    const page = await digestPage(replica);
    replica.spans.reset();
    sqlProbe.reset();
    let verified = 0;
    return {
      run: async () => {
        const applied = await replica.applyRemotePage(page);
        if (applied.digestVerified === true) verified += 1;
        return {};
      },
      extra: () => {
        const byName = replica.spans.maxByName();
        return {
          verified,
          maxSpanMs: [...byName]
            .filter(([name]) => !name.startsWith("sql."))
            .sort((left, right) => right[1] - left[1])
            .slice(0, 6)
            .map(([name, millis]) => `${name}=${Math.round(millis)}`)
            .join(" "),
          maxWriteHoldMs: sqlProbe.longestHolds()[0]?.millis ?? 0,
          longestHolds: sqlProbe
            .longestHolds()
            .slice(0, 4)
            .map((entry) => `${Math.round(entry.millis)}ms ${entry.sql}`)
            .join(" | "),
        };
      },
    };
  },
};

const DIGEST_SALE_DELAY_MILLIS = 300;

const digestWhileSelling: Scenario = {
  id: "digest-while-selling",
  title: "Digest-bearing remote page apply while invoices are enqueued every 100 ms",
  mutates: true,
  reps: () => ({ warmup: 0, measured: 1 }),
  start: async ({ replica, counts }) => {
    const page = await digestPage(replica);
    const loopDelay = monitorEventLoopDelay({ resolution: 10 });
    let sales: ReadonlyArray<number> = [];
    let refused = 0;
    let verified = 0;
    return {
      run: async () => {
        replica.spans.reset();
        sqlProbe.reset();
        loopDelay.enable();
        loopDelay.reset();
        const applying = replica.applyRemotePage(page);
        await sleep(DIGEST_SALE_DELAY_MILLIS);
        const seller = startSelling(replica, counts, "bench-digest-sale", 2_000, STEADY_SALES);
        const applied = await applying;
        await sleep(1_000);
        await seller.stop();
        loopDelay.disable();
        sales = seller.sales;
        refused = seller.refused();
        if (applied.digestVerified === true) verified += 1;
        return { rows: seller.sales.length };
      },
      extra: () => ({ verified, ...stallReport(sales, refused, loopDelay, replica) }),
    };
  },
};

const importWhileSelling: Scenario = {
  id: "import-while-selling",
  title: "Snapshot import + activation while invoices are enqueued every 100 ms",
  mutates: true,
  reps: () => ({ warmup: 0, measured: 1 }),
  start: async (context) => {
    const inner = await snapshotImport.start(context);
    const loopDelay = monitorEventLoopDelay({ resolution: 10 });
    let sales: ReadonlyArray<number> = [];
    let refused = 0;
    return {
      run: async (index) => {
        context.replica.spans.reset();
        sqlProbe.reset();
        loopDelay.enable();
        loopDelay.reset();
        const seller = startSelling(
          context.replica,
          context.counts,
          "bench-import-sale",
          1_000,
          STEADY_SALES,
        );
        const iteration = await inner.run(index);
        await seller.stop();
        loopDelay.disable();
        sales = seller.sales;
        refused = seller.refused();
        return iteration;
      },
      extra: () => stallReport(sales, refused, loopDelay, context.replica),
    };
  },
};

export const SCENARIOS: ReadonlyArray<Scenario> = [
  productPage,
  productSummary,
  productBatches,
  productBatchesPending,
  productSearch,
  deepInvoices,
  deepInvoiceItems,
  deepMovements,
  insightsFacts,
  digest,
  enqueueInvoice,
  enqueueCatalog,
  remotePageApply,
  remoteGroupApply,
  snapshotImport,
  claimUpload,
  generationCleanup("generation-cleanup", { gapMillis: 100, burst: 20, pauseMillis: 3_000 }),
  digestVerify,
  digestWhileSelling,
  importWhileSelling,
];
