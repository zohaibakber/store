import { ProductScanService, productScanLayer } from "@store/services";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { CurrentOrganization } from "../auth/organization";
import { ProductScanPayloadErrors, StoreApi } from "../http/api";
import { badGateway, badRequest, tooManyRequests } from "../http/errors";
import { ServerRuntime } from "../http/runtime";

const ProductScanPayloadErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
  ProductScanPayloadErrors,
  () =>
    Effect.fail(
      badRequest(
        "INVALID_PRODUCT_SCAN",
        "Send non-empty recognized text and choose product or batch mode.",
      ),
    ),
);

export const ProductScanHandlers = HttpApiBuilder.group(
  StoreApi,
  "productScans",
  Effect.fn("ProductScanHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers.handle(
      "parse",
      Effect.fn("ProductScanHandlers.parse")(function* ({ payload }) {
        const identity = yield* CurrentOrganization;
        const rateLimit = yield* runtime
          .limitProductScan(`${identity.organizationId}:${identity.user.id}`)
          .pipe(Effect.orDie);
        if (!rateLimit.success)
          return yield* Effect.fail(
            tooManyRequests("PRODUCT_SCAN_RATE_LIMITED", "Too many scans. Try again in a minute."),
          );

        const ai = yield* runtime.productScanAi;
        return yield* ProductScanService.pipe(
          Effect.flatMap((service) => service.parse(payload)),
          Effect.provide(productScanLayer({ ai })),
          Effect.tapError((cause) =>
            Effect.logError("Product scan parsing failed").pipe(
              Effect.annotateLogs({ cause: cause.message }),
            ),
          ),
          Effect.mapError(() =>
            badGateway("PRODUCT_SCAN_FAILED", "Could not parse the scan text. Try again."),
          ),
        );
      }),
    );
  }),
).pipe(Layer.provide(ProductScanPayloadErrorsLive));
