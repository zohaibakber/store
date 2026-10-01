export type CatalogActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

export type CatalogWriteIds = {
  readonly now: () => number;
  readonly operationId: () => string;
  readonly rowId: () => string;
};

export type CatalogReadableCollection<Row extends { readonly id: string }> = {
  readonly state: {
    get: (id: string) => Row | undefined;
    values: () => Iterable<Row>;
  };
};

export type ProjectionContext<Tables> = {
  readonly actor: CatalogActor;
  readonly commandId: string;
  readonly occurredAt: number;
  readonly ids: CatalogWriteIds;
  readonly tables: Tables;
};

export const requiredRow = <Row>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

export const commandIds = (context: ProjectionContext<unknown>) => ({
  now: () => context.occurredAt,
  operationId: () => context.commandId,
});
