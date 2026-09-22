import type { AuthSession } from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { AuthError } from "../auth/session";

export interface ServerRuntimeContract {
  readonly electronProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, AuthError, RuntimeContext | Scope.Scope>;
  readonly loadWorkspace: (
    headers: Headers,
  ) => Effect.Effect<WorkspaceSnapshot, AuthError, RuntimeContext | Scope.Scope>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitInvoiceExtraction: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeContract>()(
  "@store/server/ServerRuntime",
) {}
