import type { SyncEntity } from "@store/contracts";

import type { ReplicaQueryStamp } from "./types";

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
};

export const createInvoiceCoherenceGate = (): InvoiceCoherenceGate => {
  const activeSources = new Set<InvoiceCoherenceEntity>();
  type Pending = {
    readonly key: string;
    readonly required: ReadonlySet<InvoiceCoherenceEntity>;
    readonly publishers: Map<InvoiceCoherenceEntity, () => Promise<void>>;
  };
  let pending: Pending | undefined;

  const flush = async (batch: Pending): Promise<void> => {
    for (const publish of batch.publishers.values()) {
      await publish();
    }
  };

  return {
    registerSource: (entity) => {
      activeSources.add(entity);
      return () => {
        activeSources.delete(entity);
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
      if ([...pending.required].every((needed) => pending?.publishers.has(needed))) {
        const batch = pending;
        pending = undefined;
        await flush(batch);
      }
    },
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
