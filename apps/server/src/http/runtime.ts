import type { AuthSession } from "@store/auth";
import type { SyncRequest, SyncResponse } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { HttpBodyError } from "effect/unstable/http/HttpBody";
import type { HttpServerError } from "effect/unstable/http/HttpServerError";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { SyncDatabaseError, SyncProtocolError } from "../sync/errors";
import type { SyncActor } from "../sync/model";

/** Explicit boundary between HTTP handlers and the Cloudflare/Better Auth runtime. */
export interface ServerRuntimeShape {
  readonly electronProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly authFetch: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError | HttpBodyError,
    RuntimeContext | Scope.Scope
  >;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, never, RuntimeContext | Scope.Scope>;
  readonly hasActiveMember: (
    headers: Headers,
  ) => Effect.Effect<boolean, never, RuntimeContext | Scope.Scope>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly runSync: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError, RuntimeContext>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeShape>()(
  "@store/server/ServerRuntime",
) {}
