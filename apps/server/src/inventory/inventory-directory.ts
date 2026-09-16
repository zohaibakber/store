import type {
  InventoryImportId,
  InventoryObjectName,
  InventoryReleaseId,
  InventoryRoutingContext,
  OrganizationId,
} from "@store/contracts";
import { InventoryImportId as InventoryImportIdSchema } from "@store/contracts";
import { InventoryObjectName as InventoryObjectNameSchema } from "@store/contracts";
import { InventoryReleaseId as InventoryReleaseIdSchema } from "@store/contracts";
import { InventoryRoutingContext as InventoryRoutingContextSchema } from "@store/contracts";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DirectoryRouteRow = Schema.Struct({
  objectName: InventoryObjectNameSchema,
  importId: InventoryImportIdSchema,
  releaseId: InventoryReleaseIdSchema,
});

export class InventoryNotPublished extends Schema.TaggedError<InventoryNotPublished>()(
  "InventoryNotPublished",
  { message: Schema.String },
) {}

export class InventoryDirectoryUnavailable extends Schema.TaggedError<InventoryDirectoryUnavailable>()(
  "InventoryDirectoryUnavailable",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export type ActiveInventoryRoute = {
  readonly objectName: InventoryObjectName;
  readonly evidence: InventoryRoutingContext;
};

export interface InventoryDirectoryContract {
  readonly resolveActive: (
    organizationId: OrganizationId,
  ) => Effect.Effect<
    ActiveInventoryRoute,
    InventoryNotPublished | InventoryDirectoryUnavailable
  >;
}

const ACTIVE_ROUTE_SQL = `select e.objectName as objectName, e.importId as importId, e.releaseId as releaseId
from inventory_active_release as a
inner join inventory_dataset_release as r on r.id = a.releaseId
inner join inventory_release_entry as e
  on e.releaseId = a.releaseId and e.organizationId = ?
where r.status = 'active' and e.status = 'ready'`;

const directoryUnavailable = (cause: unknown) =>
  InventoryDirectoryUnavailable.make({
    message: "Inventory directory is unavailable.",
    cause,
  });

export const makeD1InventoryDirectory = (
  database: Cloudflare.D1.QueryDatabaseClient,
): InventoryDirectoryContract => ({
  resolveActive: Effect.fn("InventoryDirectory.resolveActive")(function* (
    organizationId: OrganizationId,
  ) {
    const row = yield* database
      .prepare(ACTIVE_ROUTE_SQL)
      .bind(organizationId)
      .first()
      .pipe(Effect.mapError((cause) => directoryUnavailable(cause)));
    if (row === null) {
      return yield* Effect.fail(
        InventoryNotPublished.make({
          message: "This organization has no published inventory.",
        }),
      );
    }
    const parsed = yield* Schema.decodeUnknownEffect(DirectoryRouteRow)(row).pipe(
      Effect.mapError((cause) => directoryUnavailable(cause)),
    );
    const evidence = yield* Schema.decodeUnknownEffect(InventoryRoutingContextSchema)({
      organizationId,
      importId: parsed.importId,
      releaseId: parsed.releaseId,
    }).pipe(Effect.mapError((cause) => directoryUnavailable(cause)));
    return { objectName: parsed.objectName, evidence };
  }, (effect) =>
    effect.pipe(
      Effect.catchAllCause((cause) => {
        if (Cause.hasDefects(cause)) {
          return Effect.fail(directoryUnavailable(Cause.squash(cause)));
        }
        return Effect.failCause(cause);
      }),
    )),
});
