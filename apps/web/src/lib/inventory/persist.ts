export const mutationMetadata = (actor: {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}) => {
  const now = Date.now();
  return {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: actor.deviceId,
    operationId: crypto.randomUUID(),
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as const;
};

export const updatedMetadata = (actor: {
  readonly userId: string;
  readonly deviceId: string;
  readonly rowVersion: number;
}) => ({
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: crypto.randomUUID(),
  rowVersion: actor.rowVersion + 1,
  updatedAt: Date.now(),
});

export const requiredRow = <Row>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

export const activeRows = <Row extends { readonly deletedAt: number | null }>(
  rows: Iterable<Row>,
) => [...rows].filter((row) => row.deletedAt === null);
