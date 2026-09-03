import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { StoreApi } from "./api";

export const SystemHandlers = HttpApiBuilder.group(StoreApi, "system", (handlers) =>
  handlers
    .handle("landing", () =>
      Effect.succeed({
        service: "Store Invoice API" as const,
        endpoints: [
          "/api/health",
          "/api/auth/*",
          "/api/inventory/*",
          "/api/uploads",
          "/api/product-scans",
        ],
      }),
    )
    .handle("status", () => Effect.succeed({ service: "Store Invoice API" as const, ok: true }))
    .handle("health", () => Effect.succeed({ ok: true })),
);
