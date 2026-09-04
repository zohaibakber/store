/** Columns assigned by the sync protocol rather than by a client payload. */
export type StoreManagedColumn =
  | "id"
  | "actorUserId"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "organizationId"
  | "createdByUserId"
  | "updatedByUserId"
  | "deviceId"
  | "operationId"
  | "rowVersion";

export const storeManagedColumnNames: ReadonlyArray<StoreManagedColumn> = [
  "id",
  "actorUserId",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "organizationId",
  "createdByUserId",
  "updatedByUserId",
  "deviceId",
  "operationId",
  "rowVersion",
];

interface ManagedFields {
  readonly id?: unknown;
  readonly actorUserId?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly deletedAt?: unknown;
  readonly organizationId?: unknown;
  readonly createdByUserId?: unknown;
  readonly updatedByUserId?: unknown;
  readonly deviceId?: unknown;
  readonly operationId?: unknown;
  readonly rowVersion?: unknown;
}

export const omitManaged = <F extends ManagedFields>(fields: F): Omit<F, StoreManagedColumn> => {
  const remaining = { ...fields };
  for (const name of storeManagedColumnNames) delete remaining[name];
  // SAFETY: Every StoreManagedColumn key was removed from the shallow clone above.
  return remaining as Omit<F, StoreManagedColumn>;
};
