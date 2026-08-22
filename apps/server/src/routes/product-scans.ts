import { ProductScanInput } from "@store/contracts";
import { ProductScanService, productScanLayer } from "@store/services";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import { badGateway, badRequest, payloadTooLarge, tooManyRequests } from "../http/errors";
import { ServerRuntime } from "../http/runtime";

const MAX_PRODUCT_SCAN_BODY_SIZE = 96 * 1024;

interface ProductScanBodyState {
  readonly chunks: ReadonlyArray<Uint8Array>;
  readonly size: number;
}

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  Stream.runFoldEffect(
    request.stream,
    (): ProductScanBodyState => ({ chunks: [], size: 0 }),
    (state, chunk) => {
      const size = state.size + chunk.byteLength;
      if (size > MAX_PRODUCT_SCAN_BODY_SIZE)
        return Effect.fail(
          payloadTooLarge("PRODUCT_SCAN_TOO_LARGE", "The recognized text is too large."),
        );
      return Effect.succeed({ chunks: [...state.chunks, chunk], size });
    },
  ).pipe(
    Effect.map(({ chunks, size }) => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    }),
    Effect.catchTag("HttpServerError", () =>
      Effect.fail(badRequest("INVALID_PRODUCT_SCAN", "The scan text could not be read.")),
    ),
  );

const decodeBody = (request: HttpServerRequest.HttpServerRequest) =>
  readBody(request).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: () => badRequest("INVALID_PRODUCT_SCAN", "The scan text could not be read."),
      }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(ProductScanInput)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        badRequest(
          "INVALID_PRODUCT_SCAN",
          "Send non-empty recognized text and choose product or batch mode.",
        ),
      ),
    ),
  );

export const ProductScanHandlers = HttpApiBuilder.group(
  StoreApi,
  "productScans",
  Effect.fn("ProductScanHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers.handleRaw(
      "parse",
      Effect.fn("ProductScanHandlers.parse")(function* ({ request }) {
        const identity = yield* CurrentOrganization;
        const input = yield* decodeBody(request);
        const rateLimit = yield* runtime
          .limitProductScan(`${identity.organizationId}:${identity.user.id}`)
          .pipe(Effect.orDie);
        if (!rateLimit.success)
          return yield* Effect.fail(
            tooManyRequests("PRODUCT_SCAN_RATE_LIMITED", "Too many scans. Try again in a minute."),
          );

        const ai = yield* runtime.productScanAi;
        return yield* ProductScanService.pipe(
          Effect.flatMap((service) => service.parse(input)),
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
);
