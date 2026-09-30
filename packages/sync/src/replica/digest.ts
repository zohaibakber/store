import {
  finishPartitionDigestReport,
  makePartitionEntityHasher,
  makePartitionLeafOrderer,
  PARTITION_ENTITIES,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
  type SyncSubscription,
} from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  pendingRowMarks,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import { inArray, sql, type SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ReplicaStorageError } from "./errors";
import type { ReplicaDb } from "./sql-client/drizzle";

const PAGE_ROWS = 4_000;

const PendingCountRow = Schema.Struct({ pendingCount: Schema.Number });
const decodePendingCountRow = Schema.decodeUnknownEffect(PendingCountRow);

const EntityBoundsRow = Schema.Struct({
  entityCount: Schema.Number,
  organizationId: Schema.NullOr(Schema.String),
  foreignRows: Schema.Number,
});
const decodeEntityBoundsRow = Schema.decodeUnknownEffect(EntityBoundsRow);

const LeafPage = Schema.Array(Schema.Struct({ entityId: Schema.String, version: Schema.String }));
const decodeLeafPage = Schema.decodeUnknownEffect(LeafPage);

type LeafTable =
  | typeof categories
  | typeof products
  | typeof batches
  | typeof invoices
  | typeof invoiceItems
  | typeof stockMovements;

const leafTables = {
  category: { table: categories, rowVersion: sql`cast(${categories.rowVersion} as integer)` },
  product: { table: products, rowVersion: sql`cast(${products.rowVersion} as integer)` },
  batch: { table: batches, rowVersion: sql`cast(${batches.rowVersion} as integer)` },
  invoice: { table: invoices, rowVersion: sql`cast(${invoices.rowVersion} as integer)` },
  invoiceItem: {
    table: invoiceItems,
    rowVersion: sql`cast(${invoiceItems.rowVersion} as integer)`,
  },
  stockMovement: { table: stockMovements, rowVersion: sql.raw(String(STOCK_MOVEMENT_ROW_VERSION)) },
} as const satisfies Record<
  PartitionEntity,
  { readonly table: LeafTable; readonly rowVersion: SQL }
>;

const malformed = () =>
  ReplicaStorageError.make({ message: "Replica partition digest rows are malformed." });

const foreignOrganization = () =>
  ReplicaStorageError.make({ message: "Replica partition holds more than one organization." });

const pendingStatement = sql`select count(*) as "pendingCount" from ${pendingRowMarks} where ${inArray(pendingRowMarks.entity, [...PARTITION_ENTITIES])}`;

const boundsStatement = (entity: PartitionEntity) => {
  const { table } = leafTables[entity];
  return sql`select
    (select count(*) from ${table}) as "entityCount",
    (select min(${table.organizationId}) from ${table}) as "organizationId",
    (select count(*) from (select 1 from ${table} where ${table.organizationId} > (select min(${table.organizationId}) from ${table}) limit 1)) as "foreignRows"`;
};

const pageStatement = (
  entity: PartitionEntity,
  organizationId: string,
  after: string | undefined,
) => {
  const { table, rowVersion } = leafTables[entity];
  const cursor = after === undefined ? sql`` : sql` and ${table.id} > ${after}`;
  return sql`select ${table.id} as "entityId", (${rowVersion}) || '' as "version" from ${table} where ${table.organizationId} = ${organizationId}${cursor} order by ${table.id} limit ${PAGE_ROWS}`;
};

export type DigestReader<Failure> = <A>(
  read: (tx: ReplicaDb) => Effect.Effect<A, EffectDrizzleQueryError>,
) => Effect.Effect<A, Failure>;

const entityDigest = <Failure>(read: DigestReader<Failure>, entity: PartitionEntity) =>
  Effect.gen(function* () {
    const bounds = yield* decodeEntityBoundsRow(
      yield* read((tx) => tx.get<unknown>(boundsStatement(entity))),
    ).pipe(Effect.mapError(malformed));
    const hasher = makePartitionEntityHasher(entity, bounds.entityCount);
    if (bounds.organizationId === null) {
      return { count: bounds.entityCount, digest: hasher.finish() };
    }
    if (bounds.foreignRows > 0) return yield* foreignOrganization();
    const organizationId = bounds.organizationId;
    const orderer = makePartitionLeafOrderer(hasher.push);
    yield* Stream.paginate(Option.none<string>(), (after) =>
      read((tx) =>
        tx.all<unknown>(pageStatement(entity, organizationId, Option.getOrUndefined(after))),
      ).pipe(
        Effect.flatMap((raw) => decodeLeafPage(raw).pipe(Effect.mapError(malformed))),
        Effect.map((rows) => {
          const last = rows.at(-1);
          return [
            rows,
            rows.length < PAGE_ROWS || last === undefined
              ? Option.none()
              : Option.some(Option.some(last.entityId)),
          ] as const;
        }),
      ),
    ).pipe(
      Stream.runForEach((row) =>
        Effect.sync(() =>
          orderer.push(row.entityId, partitionLeafOf(entity, row.entityId, row.version)),
        ),
      ),
    );
    orderer.finish();
    return { count: bounds.entityCount, digest: hasher.finish() };
  }).pipe(Effect.withSpan("ReplicaDigest.sqliteEntityDigest"));

export const readPartitionDigest = <Failure>(read: DigestReader<Failure>) =>
  Effect.gen(function* () {
    const pending = yield* decodePendingCountRow(
      yield* read((tx) => tx.get<unknown>(pendingStatement)),
    ).pipe(Effect.mapError(malformed));
    if (pending.pendingCount > 0) return undefined;
    return yield* finishPartitionDigestReport({
      category: yield* entityDigest(read, "category"),
      product: yield* entityDigest(read, "product"),
      batch: yield* entityDigest(read, "batch"),
      invoice: yield* entityDigest(read, "invoice"),
      invoiceItem: yield* entityDigest(read, "invoiceItem"),
      stockMovement: yield* entityDigest(read, "stockMovement"),
    });
  }).pipe(Effect.withSpan("ReplicaDigest.readPartitionDigest"));

export const sqlitePartitionDigest = (tx: ReplicaDb) =>
  readPartitionDigest<EffectDrizzleQueryError>((read) => read(tx)).pipe(
    Effect.withSpan("ReplicaDigest.sqlitePartitionDigest"),
  );

export const logPartitionDivergence = (
  subscription: SyncSubscription,
  diverged: ReadonlyArray<PartitionEntity>,
) => Effect.logWarning("replica partition digest diverged", { subscription, entities: diverged });
