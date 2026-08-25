export type LegacyMigrationRow = { readonly id: string; readonly updatedAt: number };
export type LegacyCreatedRow = { readonly id: string; readonly createdAt: number };

const latestBy = <Row extends { readonly id: string }>(
  rows: ReadonlyArray<Row>,
  isNewer: (candidate: Row, current: Row) => boolean,
): ReadonlyArray<Row> => {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const current = latest.get(row.id);
    if (!current || isNewer(row, current)) latest.set(row.id, row);
  }
  return [...latest.values()].sort((left, right) => left.id.localeCompare(right.id));
};

export const latestMigrationRows = <Row extends LegacyMigrationRow>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> =>
  latestBy(rows, (candidate, current) => candidate.updatedAt > current.updatedAt);

export const latestCreatedRows = <Row extends LegacyCreatedRow>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> =>
  latestBy(rows, (candidate, current) => candidate.createdAt > current.createdAt);
