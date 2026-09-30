import type { SyncEntity } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";

import { MAX_BATCH_ROWS, MAX_BATCH_SPECS } from "./sources";
import type { InventorySubsetSpec } from "./subset-spec";
import type {
  ReplicaQueryStamp,
  ReplicaReadOptions,
  ReplicaSubsetRead,
  ReplicaSubsetReader,
} from "./types";

const INVOICE_COHERENCE_ENTITIES = ["invoice", "invoiceItem", "stockMovement"] as const;

export type InvoiceCoherenceEntity = (typeof INVOICE_COHERENCE_ENTITIES)[number];

const invoiceCoherenceEntities: ReadonlySet<string> = new Set(INVOICE_COHERENCE_ENTITIES);

const isInvoiceCoherenceEntity = (entity: SyncEntity): entity is InvoiceCoherenceEntity =>
  invoiceCoherenceEntities.has(entity);

const stampKey = (stamp: ReplicaQueryStamp): string =>
  `${stamp.workspaceToken}:${stamp.generationId}:${stamp.localCommitVersion}`;

export type InvoiceCoherenceGate = {
  readonly registerSource: (entity: InvoiceCoherenceEntity) => () => void;
  readonly publish: (
    entity: InvoiceCoherenceEntity,
    stamp: ReplicaQueryStamp,
    touchedEntities: ReadonlyArray<SyncEntity>,
    publish: () => Promise<void>,
  ) => Promise<void>;
  readonly reader: (executor: ReplicaSubsetReader) => ReplicaSubsetReader;
};

class SubsetRead extends Request.Class<
  { readonly spec: InventorySubsetSpec },
  ReplicaSubsetRead,
  unknown
> {}

const batchable = (spec: InventorySubsetSpec) => spec.limit <= MAX_BATCH_ROWS;

const makeBatchResolver = (
  executor: ReplicaSubsetReader & {
    readonly readBatch: NonNullable<ReplicaSubsetReader["readBatch"]>;
  },
) =>
  RequestResolver.make<SubsetRead>((entries) =>
    Effect.tryPromise({
      try: () => executor.readBatch(entries.map((entry) => entry.request.spec)),
      catch: (cause) => cause,
    }).pipe(
      Effect.matchEffect({
        onSuccess: (batch) =>
          Effect.sync(() => {
            entries.forEach((entry, index) => {
              const rows = batch.reads[index];
              entry.completeUnsafe(
                rows === undefined
                  ? Exit.die("The batch read returned fewer results than requested.")
                  : Exit.succeed({ stamp: batch.stamp, rows }),
              );
            });
          }),
        onFailure: () =>
          Effect.forEach(
            entries,
            (entry) =>
              Effect.tryPromise({
                try: () => executor.readSubset(entry.request.spec),
                catch: (cause) => cause,
              }).pipe(
                Effect.exit,
                Effect.tap((exit) => Effect.sync(() => entry.completeUnsafe(exit))),
              ),
            { discard: true },
          ),
      }),
    ),
  ).pipe(RequestResolver.batchN(MAX_BATCH_SPECS));

export const createInvoiceCoherenceGate = (): InvoiceCoherenceGate => {
  const activeSources = new Set<InvoiceCoherenceEntity>();
  type Pending = {
    key: string;
    required: ReadonlySet<InvoiceCoherenceEntity>;
    readonly publishers: Map<InvoiceCoherenceEntity, () => Promise<void>>;
  };
  let pending: Pending | undefined;
  const resolvers = new WeakMap<ReplicaSubsetReader, RequestResolver.RequestResolver<SubsetRead>>();

  const flush = async (batch: Pending): Promise<void> => {
    for (const publish of batch.publishers.values()) {
      await publish();
    }
  };

  const satisfied = (batch: Pending): boolean =>
    [...batch.required].every((needed) => batch.publishers.has(needed));

  const releaseWaiting = (entity: InvoiceCoherenceEntity): void => {
    const batch = pending;
    if (batch === undefined || !batch.required.has(entity)) return;
    batch.required = new Set([...batch.required].filter((candidate) => candidate !== entity));
    batch.publishers.delete(entity);
    if (!satisfied(batch)) return;
    pending = undefined;
    void flush(batch).catch(() => undefined);
  };

  const resolverFor = (executor: ReplicaSubsetReader) => {
    const existing = resolvers.get(executor);
    if (existing !== undefined) return existing;
    const readBatch = executor.readBatch;
    if (readBatch === undefined) return undefined;
    const created = makeBatchResolver({
      readSubset: executor.readSubset,
      readBatch: (specs, options) => readBatch.call(executor, specs, options),
    });
    resolvers.set(executor, created);
    return created;
  };

  return {
    registerSource: (entity) => {
      activeSources.add(entity);
      return () => {
        activeSources.delete(entity);
        releaseWaiting(entity);
      };
    },
    publish: async (entity, stamp, touchedEntities, publish) => {
      const touchedCoherence = touchedEntities.filter(isInvoiceCoherenceEntity);
      const required = new Set(
        touchedCoherence.filter((candidate) => activeSources.has(candidate)),
      );
      if (required.size <= 1 || !required.has(entity)) {
        await publish();
        return;
      }
      const key = stampKey(stamp);
      if (pending && pending.key !== key) {
        const stale = pending;
        pending = undefined;
        await flush(stale);
      }
      if (!pending) {
        pending = { key, required, publishers: new Map() };
      }
      pending.publishers.set(entity, publish);
      if (satisfied(pending)) {
        const batch = pending;
        pending = undefined;
        await flush(batch);
      }
    },
    reader: (executor) => ({
      readSubset: (spec: InventorySubsetSpec, options?: ReplicaReadOptions) => {
        const resolver = resolverFor(executor);
        if (resolver === undefined || activeSources.size < 2 || !batchable(spec)) {
          return executor.readSubset(spec, options);
        }
        return Effect.runPromise(Effect.request(new SubsetRead({ spec }), resolver), {
          signal: options?.signal,
        });
      },
    }),
  };
};

export const invoiceCoherenceEntityForSource = (
  source: "invoices" | "invoiceItems" | "stockMovements",
): InvoiceCoherenceEntity => {
  switch (source) {
    case "invoices":
      return "invoice";
    case "invoiceItems":
      return "invoiceItem";
    case "stockMovements":
      return "stockMovement";
  }
};
