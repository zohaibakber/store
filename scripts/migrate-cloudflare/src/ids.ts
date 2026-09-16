import { AuthorityIncarnation, InventoryImportId, InventoryReleaseId } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MigrationId } from "./model.ts";

export interface MigrationIdsApi {
  readonly nextMigrationId: () => Effect.Effect<MigrationId>;
  readonly nextImportId: () => Effect.Effect<InventoryImportId>;
  readonly nextReleaseId: () => Effect.Effect<InventoryReleaseId>;
  readonly nextIncarnation: () => Effect.Effect<AuthorityIncarnation>;
}

export class MigrationIds extends Context.Service<MigrationIds, MigrationIdsApi>()(
  "@store/migrate/Ids",
) {}

const decodeMigrationId = Schema.decodeUnknownSync(MigrationId);
const decodeImportId = Schema.decodeUnknownSync(InventoryImportId);
const decodeReleaseId = Schema.decodeUnknownSync(InventoryReleaseId);
const decodeIncarnation = Schema.decodeUnknownSync(AuthorityIncarnation);

export const liveIdsLayer = Layer.sync(MigrationIds, () => {
  const stamp = () => crypto.randomUUID();
  return MigrationIds.of({
    nextMigrationId: () => Effect.sync(() => decodeMigrationId(`migration-${stamp()}`)),
    nextImportId: () => Effect.sync(() => decodeImportId(`import-${stamp()}`)),
    nextReleaseId: () => Effect.sync(() => decodeReleaseId(`release-${stamp()}`)),
    nextIncarnation: () => Effect.sync(() => decodeIncarnation(`incarnation-${stamp()}`)),
  });
});

export const fixedIdsLayer = (values: {
  readonly migrationId: string;
  readonly importId: string;
  readonly releaseId: string;
  readonly incarnation: string;
}): Layer.Layer<MigrationIds> =>
  Layer.sync(MigrationIds, () =>
    MigrationIds.of({
      nextMigrationId: () => Effect.succeed(decodeMigrationId(values.migrationId)),
      nextImportId: () => Effect.succeed(decodeImportId(values.importId)),
      nextReleaseId: () => Effect.succeed(decodeReleaseId(values.releaseId)),
      nextIncarnation: () => Effect.succeed(decodeIncarnation(values.incarnation)),
    }),
  );
