import type { DeviceLabel } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { PROXY_CONCURRENCY } from "./replica-admission";
import type {
  ProxyFetchRequest,
  ProxyFetchResult,
  ReplicaAuthority,
  ReplicaOpenInput,
  ReplicaWorkerBoot,
} from "./replica-rpc";
import type { ReplicaWorkerClient } from "./replica-supervisor";

export class SyncApiRequestFailure extends Schema.TaggedError<SyncApiRequestFailure>()(
  "SyncApiRequestFailure",
  { message: Schema.String },
) {}

export type ReplicaSyncApiRequest = (
  pathname: string,
  init?: {
    readonly method?: "GET" | "POST";
    readonly body?: string | null;
    readonly timeoutMillis?: number;
  },
) => Effect.Effect<ProxyFetchResult, SyncApiRequestFailure>;

export type ReplicaAuthorityHost = {
  readonly bootFor: (
    identity: typeof ReplicaOpenInput.Type,
    databasePath: string,
  ) => typeof ReplicaWorkerBoot.Type;
  readonly attach: (
    client: ReplicaWorkerClient,
    authority: ReplicaAuthority,
  ) => Effect.Effect<void, never, Scope.Scope>;
};

export const makeReplicaAuthorityHost = (options: {
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly syncApiRequest: ReplicaSyncApiRequest;
  readonly liveAccessToken: (force: boolean) => Promise<string | null>;
}): ReplicaAuthorityHost => {
  const fulfilProxyRequest = (
    client: ReplicaWorkerClient,
    request: typeof ProxyFetchRequest.Type,
  ) =>
    options
      .syncApiRequest(request.pathname, {
        method: request.method,
        body: request.bodyText,
        timeoutMillis: request.timeoutMillis,
      })
      .pipe(
        Effect.catch((failure) =>
          Effect.succeed({ ok: false, status: 503, bodyText: failure.message }),
        ),
        Effect.flatMap((result) => client.ProxyRespond({ requestId: request.requestId, result })),
      );

  const fulfilAccessTokenRequest = (
    client: ReplicaWorkerClient,
    request: { readonly requestId: string; readonly force: boolean },
  ) =>
    Effect.tryPromise(() => options.liveAccessToken(request.force)).pipe(
      Effect.orElseSucceed(() => null),
      Effect.flatMap((token) => client.AccessTokenRespond({ requestId: request.requestId, token })),
    );

  const attachNetwork = (client: ReplicaWorkerClient) =>
    Effect.gen(function* () {
      yield* client.ProxyRequests().pipe(
        Stream.mapEffect((request) => fulfilProxyRequest(client, request), {
          concurrency: PROXY_CONCURRENCY,
          unordered: true,
        }),
        Stream.runDrain,
        Effect.catchCause(() => Effect.void),
        Effect.forkScoped,
      );
      yield* client.AccessTokenRequests().pipe(
        Stream.mapEffect((request) => fulfilAccessTokenRequest(client, request), {
          concurrency: 1,
        }),
        Stream.runDrain,
        Effect.catchCause(() => Effect.void),
        Effect.forkScoped,
      );
    });

  return {
    bootFor: (identity, databasePath) => {
      switch (identity.authority) {
        case "local":
          return { ...identity, databasePath };
        case "remote":
          return {
            ...identity,
            databasePath,
            apiBaseUrl: options.apiBaseUrl,
            ...(options.deviceLabel === undefined
              ? undefined
              : { deviceLabel: options.deviceLabel }),
          };
      }
    },
    attach: (client, authority) => {
      switch (authority) {
        case "local":
          return Effect.void;
        case "remote":
          return attachNetwork(client);
      }
    },
  };
};
