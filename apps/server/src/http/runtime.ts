import type { AuthSession } from "@store/auth";
import type { SyncRequest, SyncResponse, WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AuthError } from "../auth/session";
import type { SyncDatabaseError, SyncProtocolError } from "../sync/errors";
import type { SyncActor } from "../sync/model";

export interface SyncLiveInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly authenticationExpiresAt: number;
}

export interface ServerRuntimeContract {
  readonly electronProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, AuthError, RuntimeContext | Scope.Scope>;
  readonly hasActiveMember: (
    headers: Headers,
  ) => Effect.Effect<boolean, AuthError, RuntimeContext | Scope.Scope>;
  readonly loadWorkspace: (
    headers: Headers,
  ) => Effect.Effect<WorkspaceSnapshot, AuthError, RuntimeContext | Scope.Scope>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly runSync: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError, RuntimeContext>;
  readonly connectSyncLive: (
    input: SyncLiveInput,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeContract>()(
  "@store/server/ServerRuntime",
) {}
