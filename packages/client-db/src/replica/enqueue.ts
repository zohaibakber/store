import type { SyncCommandEnvelope, SyncEntity } from "@store/contracts";

export const touchedEntitiesForCommand = (
  envelope: SyncCommandEnvelope,
): ReadonlyArray<SyncEntity> => {
  if (envelope.command._tag === "issueInvoice") {
    return ["invoice", "invoiceItem", "stockMovement", "batch"];
  }
  const entities = new Set<SyncEntity>();
  for (const write of envelope.command.payload.writes) {
    entities.add(write.entity);
    if (write.entity === "batch" && write.action === "upsert") {
      entities.add("stockMovement");
    }
  }
  return [...entities];
};

export const touchedKey = (entity: SyncEntity, id: string): string => `${entity}:${id}`;

export const touchedKeysForCommand = (envelope: SyncCommandEnvelope): ReadonlyArray<string> => {
  if (envelope.command._tag === "issueInvoice") {
    return [touchedKey("invoice", envelope.command.payload.invoiceId)];
  }
  return envelope.command.payload.writes.map((write) => touchedKey(write.entity, write.id));
};
