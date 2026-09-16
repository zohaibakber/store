import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { CurrentOrganizationContext } from "../auth/organization";
import { publicError } from "../http/errors";
import { SyncLiveUpgrade } from "../inventory/sync-authority";
import { syncActor, syncErrorStatus } from "./sync";

export const handleSyncLiveUpgrade = (identity: CurrentOrganizationContext) =>
  Effect.gen(function* () {
    const upgrade = yield* SyncLiveUpgrade;
    return yield* upgrade.handle(syncActor(identity)).pipe(
      Effect.catchTags({
        SyncUnavailableError: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(publicError("SYNC_NOT_PROVISIONED", error.message), {
              status: 503,
            }),
          ),
        SyncProtocolError: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(publicError(error.code, error.message), {
              status: syncErrorStatus(error),
            }),
          ),
      }),
    );
  });
