export type LegacyMigrationRow = { readonly id: string; readonly updatedAt: number };

export const latestMigrationRows = <Row extends LegacyMigrationRow>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> => {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const current = latest.get(row.id);
    if (!current || row.updatedAt > current.updatedAt) latest.set(row.id, row);
  }
  return [...latest.values()].sort((left, right) => left.id.localeCompare(right.id));
};
