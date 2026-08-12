import type { AuthSession } from "@store/auth";
import type { SyncRequest, SyncResponse } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { SyncDatabaseError, SyncProtocolError } from "../sync/errors";
import type { SyncActor } from "../sync/model";

export interface SyncLiveInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly authenticationExpiresAt: number;
}

/** Explicit boundary between HTTP handlers and the Cloudflare/Better Auth runtime. */
export interface ServerRuntimeShape {
  readonly electronProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly authFetch: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, RuntimeContext | Scope.Scope>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, unknown, RuntimeContext>;
  readonly hasActiveMember: (headers: Headers) => Effect.Effect<boolean, unknown, RuntimeContext>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, unknown, RuntimeContext>;
  readonly runSync: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError>;
  readonly connectSyncLive: (
    input: SyncLiveInput,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeShape>()(
  "@store/server/ServerRuntime",
) {}
