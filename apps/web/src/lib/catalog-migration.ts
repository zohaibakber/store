const migratedKey = (scopeId: string) => `tabaaq-legacy-migrated:v1:${scopeId}`;

const migrated = new Set<string>();

/**
 * The legacy sqlite files stay on disk after a successful handoff, so without a
 * marker every launch would read and re-upload the whole catalog.
 */
export const legacyCatalogMigrated = (scopeId: string) => {
  if (migrated.has(scopeId)) return true;
  try {
    return globalThis.localStorage?.getItem(migratedKey(scopeId)) === "1";
  } catch {
    return false;
  }
};

export const markLegacyCatalogMigrated = (scopeId: string) => {
  migrated.add(scopeId);
  try {
    globalThis.localStorage?.setItem(migratedKey(scopeId), "1");
  } catch {
    // Private-mode refusals only cost a repeated upload on the next launch.
  }
};
