import {
  ImportCatalogRequest,
  MAX_IMPORT_PART_BYTES,
  MAX_IMPORT_PART_ROWS,
  MAX_IMPORT_PARTS,
  SyncProtocolCode,
  type ImportId,
} from "@store/contracts";
import { sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { actorJson, bodyOrProtocolError, decodedWith, decodeEncodedRows } from "./commands";
import type { InventoryError } from "./errors";
import type { EncodedJsonBody, ImportedCatalog, InventoryActor } from "./model";
import {
  isDataException,
  protocol,
  randomHex,
  runStatement,
  withSerializationRetry,
  type InventoryDrizzle,
} from "./postgres";

export interface InventoryImportsContract {
  readonly stagePart: (
    actor: InventoryActor,
    importId: ImportId,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<EncodedJsonBody, InventoryError>;
  readonly commit: (
    actor: InventoryActor,
    importId: ImportId,
    request: ImportCatalogRequest,
  ) => Effect.Effect<ImportedCatalog, InventoryError>;
}

const CommittedRows = Schema.Tuple([
  Schema.Struct({
    body: Schema.NullOr(Schema.String),
    fanout_epoch: Schema.NullOr(Schema.String),
    fanout_horizon: Schema.NullOr(Schema.String),
    error_code: Schema.NullOr(SyncProtocolCode),
    error_message: Schema.NullOr(Schema.String),
  }),
]);

const decodeCommittedRows = Schema.decodeUnknownEffect(CommittedRows);

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(ImportCatalogRequest));

const NO_GROUP = "";

const NO_ORIGIN_REPLICA = "";

export class InventoryImports extends Context.Service<InventoryImports, InventoryImportsContract>()(
  "@store/server/InventoryImports",
) {}

export const makeInventoryImports = (db: InventoryDrizzle): InventoryImportsContract =>
  InventoryImports.of({
    stagePart: Effect.fn("InventoryImports.stagePart")(
      function* (actor, importId, partNumber, bodyText) {
        const now = yield* Clock.currentTimeMillis;
        const [row] = yield* runStatement(
          db.execute(
            sql`select "body", "error_code", "error_message" from sync.stage_import_part(
              ${actorJson(actor)}::jsonb,
              ${importId}::text,
              ${partNumber}::integer,
              ${bodyText}::text,
              ${now}::bigint,
              ${MAX_IMPORT_PART_BYTES}::integer,
              ${MAX_IMPORT_PART_ROWS}::integer,
              ${MAX_IMPORT_PARTS}::integer
            )`,
            "objects",
          ),
        ).pipe(
          Effect.catchIf(
            (error) => error._tag === "InventoryDatabaseError" && isDataException(error),
            () => protocol("INVALID_OPERATION", "The import part is not valid JSON."),
          ),
          Effect.flatMap(decodedWith(decodeEncodedRows)),
        );
        return { json: yield* bodyOrProtocolError(row) } satisfies EncodedJsonBody;
      },
    ),
    commit: Effect.fn("InventoryImports.commit")(function* (actor, importId, request) {
      const now = yield* Clock.currentTimeMillis;
      const [row] = yield* runStatement(
        withSerializationRetry(
          db.execute(
            sql`select "body", "fanout_epoch", "fanout_horizon", "error_code", "error_message"
            from sync.import_catalog(
              ${actorJson(actor)}::jsonb,
              ${importId}::text,
              ${encodeRequest(request)}::jsonb,
              ${now}::bigint,
              ${randomHex(16)}::text
            )`,
            "objects",
          ),
        ),
      ).pipe(Effect.flatMap(decodedWith(decodeCommittedRows)));
      const json = yield* bodyOrProtocolError(row);
      const fanout =
        row.fanout_epoch === null || row.fanout_horizon === null
          ? null
          : {
              epoch: row.fanout_epoch,
              horizon: row.fanout_horizon,
              group: NO_GROUP,
              byteLength: 0,
              originReplicaId: NO_ORIGIN_REPLICA,
            };
      return { json, fanout } satisfies ImportedCatalog;
    }),
  });
