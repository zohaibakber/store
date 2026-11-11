import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { OrgAuthorityApi } from "./src/authority/facade";

export interface OrgAuthorityContract extends OrgAuthorityApi<RuntimeContext> {
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | RuntimeContext
  >;
  readonly alarm: () => Effect.Effect<void, never, RuntimeContext>;
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

export class OrgAuthority extends Cloudflare.DurableObject<OrgAuthority, OrgAuthorityContract>()(
  "OrgAuthority",
) {}

export class Api extends Cloudflare.Worker<Api, {}, OrgAuthority>()("Api") {}
