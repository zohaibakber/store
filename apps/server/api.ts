import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { CommitFanout } from "./src/inventory/model";

export interface OrgHubContract {
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | RuntimeContext
  >;
  readonly publish: (input: CommitFanout) => Effect.Effect<number, never, RuntimeContext>;
  readonly revoke: (userId: string) => Effect.Effect<number, never, RuntimeContext>;
  readonly webSocketMessage: (
    socket: Cloudflare.WebSocket,
    message: string | ArrayBuffer,
  ) => Effect.Effect<void>;
  readonly webSocketClose: (
    socket: Cloudflare.WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) => Effect.Effect<void>;
}

export class OrgHub extends Cloudflare.DurableObject<OrgHub, OrgHubContract>()("OrgHub") {}

export class Api extends Cloudflare.Worker<Api, {}, OrgHub>()("Api") {}
