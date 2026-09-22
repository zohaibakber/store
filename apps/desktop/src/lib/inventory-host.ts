import type { ReplicaSqliteHandle } from "@store/client-db";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";

export type ReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly openReplicaSqlite: (
    databaseName: string,
    identity: ReplicaOpenIdentity,
  ) => Promise<ReplicaSqliteHandle>;
}

export const withAuthenticatedHttpClient = <A, E, R>(
  fetchImpl: typeof fetch,
  effect: Effect.Effect<A, E, R | HttpClient.HttpClient>,
) =>
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetchImpl),
  );
