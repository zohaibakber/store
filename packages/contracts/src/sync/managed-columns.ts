import type { StoreManagedColumn } from "@store/db/store.schema";
import { storeManagedColumnNames } from "@store/db/store.schema";
import * as Struct from "effect/Struct";

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

export const omitManaged = <F extends ManagedFields>(fields: F): Omit<F, StoreManagedColumn> =>
  Struct.omit(fields, storeManagedColumnNames);
