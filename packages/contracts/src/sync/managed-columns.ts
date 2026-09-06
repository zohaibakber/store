import type { StoreManagedColumn } from "@store/db/store.schema";
import { storeManagedColumnNames } from "@store/db/store.schema";

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
