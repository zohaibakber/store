import type {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncCommandEnvelope,
  SyncPullRequest,
  SyncPullResult,
} from "@store/contracts";
import { SyncProtocolError } from "@store/contracts";
import { SyncHttpApi } from "@store/contracts/sync/api";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import { SyncTransportInvalid, SyncTransportUnavailable } from "./replica/errors";

export type SyncTransportError = SyncTransportUnavailable | SyncTransportInvalid;

const mapTransportFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, SyncTransportError | SyncProtocolError, R> =>
  effect.pipe(
    Effect.mapError((error) => {
      if (error instanceof SyncProtocolError) {
        return error;
      }
      if (error instanceof SyncTransportUnavailable || error instanceof SyncTransportInvalid) {
        return error;
      }
      return SyncTransportUnavailable.make({
        message: "The sync transport is unavailable.",
      });
    }),
  );

export type SyncTransport = {
  readonly registerReplica: (
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncTransportError | SyncProtocolError>;
  readonly submitCommand: (
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, SyncTransportError | SyncProtocolError>;
  readonly getReceipt: (
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncTransportError | SyncProtocolError>;
  readonly pull: (
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, SyncTransportError | SyncProtocolError>;
};

export const makeSyncTransport = Effect.fn("Sync.makeTransport")(function* (baseUrl: string) {
  const client = yield* HttpApiClient.make(SyncHttpApi, { baseUrl });
  return {
    registerReplica: (request) =>
      mapTransportFailure(client.sync.registerReplica({ payload: request })),
    submitCommand: (envelope) =>
      mapTransportFailure(client.sync.submitCommand({ payload: envelope })),
    getReceipt: (operationId) =>
      mapTransportFailure(
        client.sync
          .getReceipt({ params: { operationId } })
          .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
      ),
    pull: (request) => mapTransportFailure(client.sync.pull({ payload: request })),
  } satisfies SyncTransport;
});
