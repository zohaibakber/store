import { LiveTicket, LiveTicketRequest, OPERATIONAL_SUBSCRIPTION } from "@store/contracts";
import { wakeHintsFromSseBody } from "@store/sync/browser";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { inventoryApiRoot, inventoryRequest } from "../mutations";
import { openReplicaHandleScope } from "./handle-scope";

export type OrganizationObjectLiveTransport = {
  readonly close: () => void;
};

export type OrganizationObjectLiveEngine = {
  readonly appliedCursor: () => string;
  readonly onWake: (horizon: string) => void;
  readonly resumeFromCursor: (cursor: string) => void;
};

const liveUrl = (
  apiBaseUrl: string,
  nonce: string,
  replicaId: string,
  subscription: typeof OPERATIONAL_SUBSCRIPTION,
  afterHorizon: string | undefined,
): string => {
  const live = new URL(`${inventoryApiRoot(apiBaseUrl)}/sync/live`);
  live.searchParams.set("nonce", nonce);
  live.searchParams.set("replicaId", replicaId);
  live.searchParams.set("subscription", subscription);
  if (afterHorizon !== undefined) live.searchParams.set("afterHorizon", afterHorizon);
  return live.href;
};

const continueWithHttpPolling = (): undefined => undefined;

export const connectOrganizationObjectLiveTransport = async (
  authenticatedFetch: typeof fetch,
  apiBaseUrl: string,
  replicaId: string,
  engine: OrganizationObjectLiveEngine,
): Promise<OrganizationObjectLiveTransport | undefined> => {
  try {
    const ticket = await inventoryRequest({
      apiBaseUrl,
      authenticatedFetch,
      path: "/sync/live-tickets",
      body: Schema.encodeSync(LiveTicketRequest)({
        replicaId,
        subscription: OPERATIONAL_SUBSCRIPTION,
      }),
      decode: Schema.decodeUnknownSync(LiveTicket),
      failureLabel: "Live ticket mint failed.",
    });

    const lifetime = openReplicaHandleScope();
    const abort = new AbortController();
    lifetime.addSyncFinalizer(() => {
      abort.abort();
    });

    try {
      const response = await authenticatedFetch(
        liveUrl(apiBaseUrl, ticket.nonce, replicaId, ticket.subscription, engine.appliedCursor()),
        {
          method: "GET",
          headers: { accept: "text/event-stream" },
          signal: abort.signal,
        },
      );
      if (!response.ok || response.body === null) {
        lifetime.closeSync();
        return continueWithHttpPolling();
      }

      await lifetime.runInScope(
        wakeHintsFromSseBody(response.body).pipe(
          Stream.runForEach((hint) =>
            Effect.sync(() => {
              engine.onWake(hint.horizon);
            }),
          ),
          Effect.catchCause(() =>
            Effect.sync(() => {
              engine.resumeFromCursor(engine.appliedCursor());
            }),
          ),
          Effect.forkScoped,
        ),
      );

      return {
        close: () => {
          lifetime.close();
        },
      };
    } catch {
      lifetime.close();
      return continueWithHttpPolling();
    }
  } catch {
    return continueWithHttpPolling();
  }
};

export type ReplicaLiveFeed =
  | {
      readonly _tag: "catchingUp";
      readonly targetCommitSequence: string;
    }
  | {
      readonly _tag: "following";
    };
