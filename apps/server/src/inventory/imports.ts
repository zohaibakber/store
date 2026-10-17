import {
  ImportCatalogResult,
  type ImportCatalogRequest,
  type ImportId,
  type ImportStatus,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { answered, type AuthorityNamespace } from "./authority-client";
import { InventoryDatabaseError, type InventoryError } from "./errors";
import type { EncodedCommit, EncodedJsonBody, InventoryActor } from "./model";

const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportCatalogResult));

export interface InventoryImportsContract<R = never> {
  readonly stagePart: (
    actor: InventoryActor,
    importId: ImportId,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<EncodedJsonBody, InventoryError, R>;
  readonly commit: (
    actor: InventoryActor,
    importId: ImportId,
    request: ImportCatalogRequest,
  ) => Effect.Effect<EncodedCommit, InventoryError, R>;
  readonly status: (
    actor: InventoryActor,
    importId: ImportId,
  ) => Effect.Effect<ImportStatus, InventoryError, R>;
}

export class InventoryImports extends Context.Service<
  InventoryImports,
  InventoryImportsContract<RuntimeContext>
>()("@store/server/InventoryImports") {}

export const makeInventoryImports = <R, E>(
  authorities: AuthorityNamespace<R, E>,
): InventoryImportsContract<R> => ({
  stagePart: Effect.fn("InventoryImports.stagePart")(
    function* (actor, importId, partNumber, bodyText) {
      const json = yield* answered(
        authorities
          .getByName(actor.organizationId)
          .stageImportPart(actor, importId, partNumber, bodyText),
      );
      return { json } satisfies EncodedJsonBody;
    },
  ),
  commit: Effect.fn("InventoryImports.commit")(function* (actor, importId, request) {
    return yield* answered(
      authorities.getByName(actor.organizationId).commitImport(actor, importId, request),
    );
  }),
  status: Effect.fn("InventoryImports.status")(function* (actor, importId) {
    const status = yield* answered(
      authorities.getByName(actor.organizationId).importStatus(actor, importId),
    );
    switch (status._tag) {
      case "committed": {
        const result = yield* decodeResult(status.json).pipe(
          Effect.mapError((error) =>
            InventoryDatabaseError.make({ message: error.message, cause: error }),
          ),
        );
        return { _tag: "committed", result } satisfies ImportStatus;
      }
      case "other":
        return { _tag: "other", message: status.message } satisfies ImportStatus;
      case "none":
        return { _tag: "none" } satisfies ImportStatus;
    }
  }),
});
