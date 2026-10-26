import type { NoticeAccumulator } from "@store/client-db";
import type {
  AnalyticsStore,
  ClassifiedProduct,
  InventorySnapshot,
  InventorySource,
  InventoryStamp,
  SalesDays,
  SalesRow,
  StagedProduct,
} from "@store/client-db/node-analytics";
import { AnalyticsFailure } from "@store/client-db/node-analytics";
import {
  ANALYTICS_ALGORITHM_VERSION,
  ANALYTICS_HISTORY_DAYS,
  insightsDayOf,
  stockPolicyVersion,
  type AnalyticsRun,
  type AbcClass,
  type InsightsBatchFact,
  type InsightsContext,
  type InsightsOnOrderFact,
  type InsightsProductFact,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import {
  abcLookup,
  analyzeProducts,
  classifyRevenueRanking,
  groupBatchesByProduct,
  insightsWindowFor,
  onOrderChanges,
  onOrderLookup,
  RANKING_DAYS,
  reclassifyAffected,
  summarizeRun,
} from "@store/services/insights";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { RELEVANT_ENTITIES, type ChangeFeed } from "./analytics-changes";

const PRODUCT_PAGE_SIZE = 500;
const SALES_READ_BUDGET_MILLIS = 150;
const INCREMENTAL_PRODUCT_LIMIT = 2_000;
const RECONCILE_PRODUCT_LIMIT = 2_000;
const SETTLE_ROUNDS = 40;
const FULL_RUN_ATTEMPTS = 3;

type PipelineDeps = {
  readonly source: InventorySource;
  readonly store: AnalyticsStore;
  readonly changes: ChangeFeed;
  readonly progress: (done: number, total: number) => Effect.Effect<void>;
};

type RefreshRequest = {
  readonly context: InsightsContext;
  readonly pending: NoticeAccumulator | undefined;
  readonly verifyStamp: boolean;
};

type RefreshOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "full" | "incremental"; readonly run: AnalyticsRun };

type RunDates = {
  readonly now: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
  readonly days: SalesDays;
  readonly window: ReplicaInsightsWindow;
};

class SourceMoved extends Schema.TaggedError<SourceMoved>()("SourceMoved", {}) {}

const datesOf = (now: number, context: InsightsContext): RunDates => {
  const utcOffsetMinutes = context.utcOffsetMinutes;
  const today = insightsDayOf(now, utcOffsetMinutes);
  return {
    now,
    today,
    utcOffsetMinutes,
    days: { firstDay: today - ANALYTICS_HISTORY_DAYS + 1, lastDay: today, utcOffsetMinutes },
    window: insightsWindowFor(now, utcOffsetMinutes),
  };
};

const stagedOf = (
  products: ReadonlyArray<InsightsProductFact>,
  batches: ReadonlyArray<InsightsBatchFact>,
): ReadonlyArray<StagedProduct> => {
  const byProduct = groupBatchesByProduct(batches);
  return products.map((product) => ({ product, batches: byProduct[product.id] ?? [] }));
};

const readAt = <A>(
  deps: PipelineDeps,
  generation: string,
  work: (snapshot: InventorySnapshot) => Effect.Effect<A, AnalyticsFailure>,
) =>
  deps.source.snapshot((snapshot): Effect.Effect<A, AnalyticsFailure | SourceMoved> =>
    snapshot.stamp.generation === generation ? work(snapshot) : Effect.fail(new SourceMoved()),
  );

const copySource = Effect.fn("AnalyticsPipeline.copySource")(function* (
  deps: PipelineDeps,
  runId: number,
  base: InventoryStamp,
  dates: RunDates,
  reportCopied: (count: number) => Effect.Effect<void>,
) {
  let through = base;
  let nextDay = dates.days.firstDay;
  while (nextDay <= dates.days.lastDay) {
    const first = nextDay;
    const read = yield* readAt(
      deps,
      base.generation,
      Effect.fn("AnalyticsPipeline.readSalesDays")(function* (snapshot) {
        const deadline = (yield* Clock.currentTimeMillis) + SALES_READ_BUDGET_MILLIS;
        const sales: Array<SalesRow> = [];
        let day = first;
        do {
          sales.push(...(yield* snapshot.sales({ ...dates.days, firstDay: day, lastDay: day })));
          day += 1;
        } while (day <= dates.days.lastDay && (yield* Clock.currentTimeMillis) < deadline);
        return { stamp: snapshot.stamp, sales, nextDay: day };
      }),
    );
    yield* deps.store.workSales.insert(runId, read.sales);
    through = read.stamp;
    nextDay = read.nextDay;
    yield* Effect.yieldNow;
  }
  yield* Stream.paginate(
    "",
    Effect.fn("AnalyticsPipeline.copyProductPage")(function* (after: string) {
      const read = yield* readAt(
        deps,
        base.generation,
        Effect.fn("AnalyticsPipeline.readProductPage")(function* (snapshot) {
          const products = yield* snapshot.productPage(after, PRODUCT_PAGE_SIZE);
          const first = products[0];
          const last = products.at(-1);
          return {
            stamp: snapshot.stamp,
            products,
            batches:
              first === undefined || last === undefined
                ? []
                : yield* snapshot.batchesBetween(first.id, last.id),
          };
        }),
      );
      through = read.stamp;
      const last = read.products.at(-1);
      if (last === undefined) return [[], Option.none()] as const;
      yield* deps.store.staged.write(runId, stagedOf(read.products, read.batches));
      yield* reportCopied(read.products.length);
      yield* Effect.yieldNow;
      return [
        [read.products.length],
        read.products.length < PRODUCT_PAGE_SIZE ? Option.none() : Option.some(last.id),
      ] as const;
    }),
  ).pipe(Stream.runDrain);
  return through;
});

type Settled<A> = { readonly stamp: InventoryStamp; readonly value: A };

type Attempt<A> =
  | { readonly kind: "moved" }
  | { readonly kind: "declined" }
  | { readonly kind: "behind"; readonly stamp: InventoryStamp }
  | { readonly kind: "settled"; readonly value: A };

const settle = Effect.fn("AnalyticsPipeline.settle")(function* <A>(
  deps: PipelineDeps,
  base: InventoryStamp,
  start: InventoryStamp,
  initialKeys: Iterable<string>,
  work: (
    snapshot: InventorySnapshot,
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<A | undefined, AnalyticsFailure>,
) {
  const covered = new Set(initialKeys);
  let target = start;
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    const changed = yield* deps.changes.since(base, target);
    if (changed.kind === "reset") return yield* new SourceMoved();
    for (const key of changed.keys) covered.add(key);
    const keys = [...covered];
    const expected = target;
    const attempt = yield* deps.source.snapshot(
      (snapshot): Effect.Effect<Attempt<A>, AnalyticsFailure> => {
        if (snapshot.stamp.generation !== base.generation) {
          return Effect.succeed({ kind: "moved" });
        }
        if (snapshot.stamp.version !== expected.version) {
          return Effect.succeed({ kind: "behind", stamp: snapshot.stamp });
        }
        return work(snapshot, keys).pipe(
          Effect.map((value) =>
            value === undefined ? { kind: "declined" } : { kind: "settled", value },
          ),
        );
      },
    );
    switch (attempt.kind) {
      case "moved":
        return yield* new SourceMoved();
      case "declined":
        return undefined;
      case "settled":
        return { stamp: expected, value: attempt.value } satisfies Settled<A>;
      case "behind":
        target = attempt.stamp;
        break;
    }
  }
  return yield* new SourceMoved();
});

const readChanged = Effect.fn("AnalyticsPipeline.readChanged")(function* (
  snapshot: InventorySnapshot,
  keys: ReadonlyArray<string>,
  dates: RunDates,
) {
  const resolution = yield* snapshot.resolveTouched(keys, RECONCILE_PRODUCT_LIMIT);
  if (
    resolution.unresolved ||
    resolution.overflow ||
    resolution.productIds.size > RECONCILE_PRODUCT_LIMIT
  ) {
    return undefined;
  }
  const productIds = [...resolution.productIds];
  const products = productIds.length === 0 ? [] : yield* snapshot.productsByIds(productIds);
  return {
    productIds,
    entries: stagedOf(
      products,
      productIds.length === 0 ? [] : yield* snapshot.batchesForProducts(productIds),
    ),
    sales: productIds.length === 0 ? [] : yield* snapshot.sales(dates.days, productIds),
    onOrder: yield* snapshot.onOrder(),
    facts: yield* snapshot.windowFacts(dates.window),
  };
});

const analyzeStaged = Effect.fn("AnalyticsPipeline.analyzeStaged")(function* (
  deps: PipelineDeps,
  runId: number,
  context: InsightsContext,
  dates: RunDates,
  onOrder: ReadonlyArray<InsightsOnOrderFact>,
  reportAnalyzed: (count: number) => Effect.Effect<void>,
) {
  const { store } = deps;
  const onOrderOf = onOrderLookup(onOrder);
  const abc = new Map<string, AbcClass>();
  const ranking = yield* store.workSales.revenueRanking(
    runId,
    dates.today - RANKING_DAYS + 1,
    dates.today,
  );
  classifyRevenueRanking(ranking, (id, klass) => abc.set(id, klass));
  yield* Stream.paginate(
    "",
    Effect.fn("AnalyticsPipeline.analyzeProductPage")(function* (after: string) {
      const staged = yield* store.staged.page(runId, after, PRODUCT_PAGE_SIZE);
      const first = staged[0];
      const last = staged.at(-1);
      if (first === undefined || last === undefined) return [[], Option.none()] as const;
      const sales = yield* store.workSales.range(runId, first.product.id, last.product.id);
      const analyses = analyzeProducts({
        products: staged.map((entry) => entry.product),
        batches: staged.flatMap((entry) => entry.batches),
        sales,
        onOrderOf,
        abcOf: abcLookup(abc),
        policy: context.policy,
        now: dates.now,
        today: dates.today,
        utcOffsetMinutes: dates.utcOffsetMinutes,
      });
      yield* store.writeProducts(runId, analyses);
      yield* reportAnalyzed(staged.length);
      yield* Effect.yieldNow;
      return [
        [staged.length],
        staged.length < PRODUCT_PAGE_SIZE ? Option.none() : Option.some(last.product.id),
      ] as const;
    }),
  ).pipe(Stream.runDrain);
});

const attemptFull = Effect.fn("AnalyticsPipeline.attemptFull")(function* (
  deps: PipelineDeps,
  context: InsightsContext,
  dates: RunDates,
) {
  const { store } = deps;
  const start = yield* deps.source.snapshot((snapshot) =>
    Effect.map(snapshot.productCount(), (count) => ({ stamp: snapshot.stamp, count })),
  );
  const total = start.count * 2;
  let done = 0;
  const advance = (count: number) => {
    done = Math.min(total, done + count);
    return deps.progress(done, total);
  };
  yield* deps.progress(0, total);
  const runId = yield* store.allocateRun();
  const copiedThrough = yield* copySource(deps, runId, start.stamp, dates, advance);
  const settled = yield* settle(deps, start.stamp, copiedThrough, [], (snapshot, keys) =>
    readChanged(snapshot, keys, dates),
  );
  if (settled === undefined) return yield* new SourceMoved();
  const changed = settled.value;
  if (changed.productIds.length > 0) {
    yield* store.staged.replace(runId, changed);
  }
  yield* analyzeStaged(deps, runId, context, dates, changed.onOrder, advance);
  const { days, hours } = changed.facts;
  const completedAt = yield* Clock.currentTimeMillis;
  return yield* store.publish({
    runId,
    kind: "full",
    generatedAt: dates.now,
    completedAt,
    sourceGeneration: settled.stamp.generation,
    sourceVersion: settled.stamp.version,
    policyVersion: stockPolicyVersion(context.policy),
    algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
    today: dates.today,
    utcOffsetMinutes: dates.utcOffsetMinutes,
    summarize: (reader, published) =>
      summarizeRun({
        reader,
        run: published,
        policy: context.policy,
        now: dates.now,
        days,
        hours,
      }),
  });
});

const runFull = (deps: PipelineDeps, context: InsightsContext, dates: RunDates) =>
  attemptFull(deps, context, dates).pipe(
    Effect.retry({ times: FULL_RUN_ATTEMPTS - 1, while: (error) => error instanceof SourceMoved }),
    Effect.catchTag("SourceMoved", () =>
      Effect.fail(
        new AnalyticsFailure({ message: "The inventory kept changing during the insights run." }),
      ),
    ),
  );

const readIncremental = Effect.fn("AnalyticsPipeline.readIncremental")(function* (
  snapshot: InventorySnapshot,
  keys: ReadonlyArray<string>,
  stored: ReadonlyArray<ClassifiedProduct>,
  storedOnOrder: ReadonlyArray<InsightsOnOrderFact>,
  dates: RunDates,
) {
  const resolution = yield* snapshot.resolveTouched(keys, INCREMENTAL_PRODUCT_LIMIT);
  if (resolution.unresolved || resolution.overflow) return undefined;
  const onOrder = yield* snapshot.onOrder();
  const affected = new Set([...resolution.productIds, ...onOrderChanges(storedOnOrder, onOrder)]);
  if (affected.size > INCREMENTAL_PRODUCT_LIMIT) return undefined;
  const affectedIds = [...affected];
  const products = yield* snapshot.productsByIds(affectedIds);
  const affectedSales =
    affectedIds.length === 0 ? [] : yield* snapshot.sales(dates.days, affectedIds);
  const { abc, flipped } = reclassifyAffected({
    stored,
    affected,
    visibleAffected: new Set(products.map((product) => product.id)),
    sales: affectedSales,
    today: dates.today,
  });
  if (affected.size + flipped.length > INCREMENTAL_PRODUCT_LIMIT) return undefined;
  const flippedProducts = flipped.length === 0 ? [] : yield* snapshot.productsByIds(flipped);
  const flippedSales: ReadonlyArray<SalesRow> =
    flippedProducts.length === 0
      ? []
      : yield* snapshot.sales(
          dates.days,
          flippedProducts.map((product) => product.id),
        );
  const targets = [...products, ...flippedProducts];
  const targetIds = targets.map((product) => product.id);
  return {
    replaced: [...affectedIds, ...flipped],
    targets,
    batches: targets.length === 0 ? [] : yield* snapshot.batchesForProducts(targetIds),
    sales: [...affectedSales, ...flippedSales],
    onOrder,
    abc,
    facts: yield* snapshot.windowFacts(dates.window),
  };
});

const runIncremental = Effect.fn("AnalyticsPipeline.runIncremental")(function* (
  deps: PipelineDeps,
  context: InsightsContext,
  published: AnalyticsRun,
  pendingKeys: ReadonlyArray<string>,
  start: InventoryStamp,
  dates: RunDates,
) {
  const { store } = deps;
  const base = { generation: published.sourceGeneration, version: published.sourceVersion };
  const stored = yield* store.rankingOf(published.runId);
  const storedOnOrder = yield* store.onOrderOf(published.runId);
  yield* deps.progress(0, pendingKeys.length);
  const settled = yield* settle(deps, base, start, pendingKeys, (snapshot, keys) =>
    readIncremental(snapshot, keys, stored, storedOnOrder, dates),
  ).pipe(Effect.catchTag("SourceMoved", () => Effect.succeed(undefined)));
  if (settled === undefined) return undefined;
  const read = settled.value;
  const analyses = analyzeProducts({
    products: read.targets,
    batches: read.batches,
    sales: read.sales,
    onOrderOf: onOrderLookup(read.onOrder),
    abcOf: abcLookup(read.abc),
    policy: context.policy,
    now: dates.now,
    today: dates.today,
    utcOffsetMinutes: dates.utcOffsetMinutes,
  });
  const { days, hours } = read.facts;
  const completedAt = yield* Clock.currentTimeMillis;
  const run = yield* store.publish({
    runId: published.runId,
    kind: "incremental",
    generatedAt: dates.now,
    completedAt,
    sourceGeneration: settled.stamp.generation,
    sourceVersion: settled.stamp.version,
    policyVersion: stockPolicyVersion(context.policy),
    algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
    today: dates.today,
    utcOffsetMinutes: dates.utcOffsetMinutes,
    replace: { productIds: read.replaced, analyses },
    summarize: (reader, next) =>
      summarizeRun({ reader, run: next, policy: context.policy, now: dates.now, days, hours }),
  });
  yield* deps.progress(pendingKeys.length, pendingKeys.length);
  return run;
});

const relevantKeys = (pending: NoticeAccumulator) => {
  const keys: Array<string> = [];
  for (const entity of RELEVANT_ENTITIES) {
    if (pending.overflowed.has(entity)) return undefined;
    keys.push(...(pending.keys.get(entity) ?? []));
  }
  return keys;
};

export const refreshAnalytics = Effect.fn("AnalyticsPipeline.refresh")(function* (
  deps: PipelineDeps,
  request: RefreshRequest,
) {
  const dates = datesOf(yield* Clock.currentTimeMillis, request.context);
  const published = yield* deps.store.publishedRun();
  const stamp = yield* deps.source.snapshot((snapshot) => Effect.succeed(snapshot.stamp));
  const contextChanged =
    published === undefined ||
    published.algorithmVersion !== ANALYTICS_ALGORITHM_VERSION ||
    published.policyVersion !== stockPolicyVersion(request.context.policy) ||
    published.utcOffsetMinutes !== dates.utcOffsetMinutes ||
    published.today !== dates.today ||
    published.sourceGeneration !== stamp.generation ||
    published.sourceVersion > stamp.version;
  const full = () =>
    runFull(deps, request.context, dates).pipe(
      Effect.map((run): RefreshOutcome => ({ kind: "full", run })),
    );
  if (contextChanged || published === undefined) return yield* full();
  const pending = request.pending;
  if (pending?.full === true) return yield* full();
  const covered = pending === undefined || pending.version <= published.sourceVersion;
  if (covered) {
    return request.verifyStamp && published.sourceVersion !== stamp.version
      ? yield* full()
      : ({ kind: "none" } satisfies RefreshOutcome);
  }
  const keys = relevantKeys(pending);
  if (keys === undefined) return yield* full();
  if (keys.length === 0) return { kind: "none" } satisfies RefreshOutcome;
  const run = yield* runIncremental(deps, request.context, published, keys, stamp, dates);
  return run === undefined
    ? yield* full()
    : ({ kind: "incremental", run } satisfies RefreshOutcome);
});
