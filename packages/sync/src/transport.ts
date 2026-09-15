import { SyncHttpApi } from "@store/contracts/sync/api";
import type {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncCommandEnvelope,
  SyncPullRequest,
  SyncPullResult,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

export type SyncTransport = {
  readonly registerReplica: (
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, unknown>;
  readonly submitCommand: (envelope: SyncCommandEnvelope) => Effect.Effect<CommandReceipt, unknown>;
  readonly getReceipt: (operationId: string) => Effect.Effect<CommandReceipt, unknown>;
  readonly pull: (request: SyncPullRequest) => Effect.Effect<SyncPullResult, unknown>;
};

/** Typed client for `SyncHttpApi`. Hosts inject fetch/auth through Effect HttpClient. */
export const makeSyncTransport = Effect.fn("Sync.makeTransport")(function* (baseUrl: string) {
  const client = yield* HttpApiClient.make(SyncHttpApi, { baseUrl });
  return {
    registerReplica: (request) => client.sync.registerReplica({ payload: request }),
    submitCommand: (envelope) => client.sync.submitCommand({ payload: envelope }),
    getReceipt: (operationId) => client.sync.getReceipt({ params: { operationId } }),
    pull: (request) => client.sync.pull({ payload: request }),
  } satisfies SyncTransport;
});
