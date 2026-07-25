import type { StoreManagedColumn } from "@store/db/store.schema";
import { storeManagedColumnNames } from "@store/db/store.schema";

export const omitManaged = <F extends Record<string, unknown>>(
  fields: F,
): Omit<F, StoreManagedColumn> => {
  const remaining = { ...fields };
  for (const name of storeManagedColumnNames) delete remaining[name];
  return remaining as Omit<F, StoreManagedColumn>;
};
