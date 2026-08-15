import { SyncRequest, SyncResponse } from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

export interface OrganizationStoreContract {
  readonly exchange: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError, RuntimeContext>;
}

export class OrganizationStore extends Cloudflare.DurableObject<
  OrganizationStore,
  OrganizationStoreContract
>()("ORGANIZATION_STORE") {}

export const OrganizationStoreLive = OrganizationStore.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.sync(() => {
      const runtime = makeSyncRuntime(state.raw.storage);

      const exchange = Effect.fn("OrganizationStore.exchange")(function* (
        actor: SyncActor,
        request: SyncRequest,
      ) {
        return yield* Effect.tryPromise({
          try: () => runtime.runSync(actor, request),
          catch: (cause) =>
            cause instanceof SyncProtocolError
              ? cause
              : SyncDatabaseError.make({
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
        });
      });

      return { exchange };
    });
  }),
);

export type OrganizationStoreNamespace = Effect.Success<typeof OrganizationStore>;
