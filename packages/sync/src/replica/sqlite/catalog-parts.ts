import {
  MAX_IMPORT_PART_BYTES,
  MAX_IMPORT_PART_ROWS,
  SnapshotRow,
  STOCK_MOVEMENT_ROW_VERSION,
  type SyncEntity,
} from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import { and, asc, eq, gt } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Struct from "effect/Struct";

import { ReplicaStorageError } from "../errors";
import type { ReplicaDb } from "../sql-client/drizzle";

export type CatalogPart = {
  readonly partNumber: number;
  readonly rowCount: number;
  readonly bodyText: string;
};

type Frame = { readonly text: string; readonly bytes: number };

type OpenPart = {
  readonly partNumber: number;
  readonly rowCount: number;
  readonly body: string;
  readonly bytes: number;
};

const PAGE_ROWS = 1_000;

const PART_FOOTER = "]}";

const CATALOG_ENTITIES: ReadonlyArray<SyncEntity> = Struct.keys(syncEntityRows);

const utf8 = new TextEncoder();

const byteLength = (text: string) => utf8.encode(text).byteLength;

const encodeFrame = Schema.encodeSync(Schema.fromJsonString(SnapshotRow));

const unreadable = (entity: SyncEntity) =>
  ReplicaStorageError.make({ message: `This device holds a ${entity} record it cannot read.` });

const versionOf = (row: SyncEntityRow<SyncEntity>): number =>
  "rowVersion" in row ? row.rowVersion : STOCK_MOVEMENT_ROW_VERSION;

const entityFrames = (db: ReplicaDb, organizationId: string, entity: SyncEntity) => {
  const { table, schema } = syncEntityRows[entity];
  const decode = Schema.decodeUnknownSync(schema);
  return Stream.paginate(Option.none<string>(), (after) =>
    db
      .select()
      .from(table)
      .where(
        and(
          eq(table.organizationId, organizationId),
          Option.isNone(after) ? undefined : gt(table.id, after.value),
        ),
      )
      .orderBy(asc(table.id))
      .limit(PAGE_ROWS)
      .all()
      .pipe(
        Effect.flatMap((page) =>
          Effect.try({
            try: () => {
              const rows = page.map((raw) => decode(raw));
              const last = rows.at(-1);
              const frames = rows.map((row): Frame => {
                const text = encodeFrame({
                  entity,
                  entityId: row.id,
                  rowVersion: versionOf(row),
                  row,
                });
                return { text, bytes: byteLength(text) };
              });
              return [
                frames,
                rows.length < PAGE_ROWS || last === undefined
                  ? Option.none<Option.Option<string>>()
                  : Option.some(Option.some<string>(last.id)),
              ] as const;
            },
            catch: () => unreadable(entity),
          }),
        ),
      ),
  );
};

const openPart = (partId: string, partNumber: number): OpenPart => {
  const body = `{"snapshotId":${JSON.stringify(partId)},"partNumber":${partNumber},"rows":[`;
  return { partNumber, rowCount: 0, body, bytes: byteLength(body) + PART_FOOTER.length };
};

const appendFrame = (part: OpenPart, frame: Frame): OpenPart => ({
  partNumber: part.partNumber,
  rowCount: part.rowCount + 1,
  body: part.rowCount === 0 ? `${part.body}${frame.text}` : `${part.body},${frame.text}`,
  bytes: part.bytes + frame.bytes + (part.rowCount === 0 ? 0 : 1),
});

const closePart = (part: OpenPart): CatalogPart => ({
  partNumber: part.partNumber,
  rowCount: part.rowCount,
  bodyText: `${part.body}${PART_FOOTER}`,
});

const packFrame =
  (partId: string) =>
  (part: OpenPart, frame: Frame): readonly [OpenPart, ReadonlyArray<CatalogPart>] => {
    const grown = appendFrame(part, frame);
    return part.rowCount === 0 ||
      (grown.rowCount <= MAX_IMPORT_PART_ROWS && grown.bytes <= MAX_IMPORT_PART_BYTES)
      ? [grown, []]
      : [appendFrame(openPart(partId, part.partNumber + 1), frame), [closePart(part)]];
  };

const lastPart = (part: OpenPart): ReadonlyArray<CatalogPart> =>
  part.rowCount === 0 ? [] : [closePart(part)];

export const sqliteCatalogParts = (
  db: ReplicaDb,
  input: { readonly partId: string; readonly organizationId: string },
): Stream.Stream<CatalogPart, EffectDrizzleQueryError | ReplicaStorageError> =>
  Stream.fromIterable(CATALOG_ENTITIES).pipe(
    Stream.flatMap((entity) => entityFrames(db, input.organizationId, entity)),
    Stream.mapAccum(() => openPart(input.partId, 1), packFrame(input.partId), {
      onHalt: lastPart,
    }),
  );
