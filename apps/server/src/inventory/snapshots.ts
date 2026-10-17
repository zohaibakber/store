import {
  AcquireSnapshotResult,
  type AcquireSnapshotRequest,
  type SnapshotId,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { answered, type AuthorityNamespace } from "./authority-client";
import { InventoryDatabaseError, type InventoryError } from "./errors";
import type { EncodedSnapshotPart, InventoryActor } from "./model";

const decodeAcquired = Schema.decodeUnknownEffect(AcquireSnapshotResult);

export interface InventorySnapshotsContract<R = never> {
  readonly acquireSnapshot: (
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, InventoryError, R>;
  readonly readSnapshotPartEncoded: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<EncodedSnapshotPart, InventoryError, R>;
}

export class InventorySnapshots extends Context.Service<
  InventorySnapshots,
  InventorySnapshotsContract<RuntimeContext>
>()("@store/server/InventorySnapshots") {}

export const makeInventorySnapshots = <R, E>(
  authorities: AuthorityNamespace<R, E>,
): InventorySnapshotsContract<R> => ({
  acquireSnapshot: Effect.fn("InventorySnapshots.acquireSnapshot")(function* (actor, request) {
    const acquired = yield* answered(
      authorities.getByName(actor.organizationId).acquireSnapshot(actor, request),
    );
    return yield* decodeAcquired(acquired).pipe(
      Effect.mapError((error) =>
        InventoryDatabaseError.make({ message: error.message, cause: error }),
      ),
    );
  }),
  readSnapshotPartEncoded: Effect.fn("InventorySnapshots.readSnapshotPartEncoded")(
    function* (actor, snapshotId, partNumber) {
      return yield* answered(
        authorities.getByName(actor.organizationId).readSnapshotPart(actor, snapshotId, partNumber),
      );
    },
  ),
});
