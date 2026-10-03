import type { AccessTokenVerifier } from "@store/auth";
import type {
  GlobalSearchError,
  GlobalSearchOutcome,
  InvoiceAiClient,
  ProductScanAiClient,
} from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { GlobalSearchCacheContract } from "../global-search/cache";

export const RATE_LIMITS = {
  invoiceExtraction: { limit: 10, period: 60 },
  productScan: { limit: 30, period: 60 },
  globalSearch: { limit: 10, period: 60 },
} as const;

export interface ServerRuntimeContract {
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly verifyAccessToken: AccessTokenVerifier;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitInvoiceExtraction: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly globalSearchCache: GlobalSearchCacheContract;
  readonly searchGlobalProducts: (
    query: string,
  ) => Effect.Effect<GlobalSearchOutcome, GlobalSearchError>;
  readonly limitGlobalSearch: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeContract>()(
  "@store/server/ServerRuntime",
) {}
