import { ProductScanInput } from "@store/contracts";
import { ProductScanService, productScanLayer } from "@store/services";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { productScanAiClient } from "../ai/product-scan-ai";
import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";

const MAX_PRODUCT_SCAN_BODY_SIZE = 96 * 1024;

export const productScansRoute = new Hono<AppEnv>().post(
  "/",
  bodyLimit({
    maxSize: MAX_PRODUCT_SCAN_BODY_SIZE,
    onError: (c) =>
      c.json(publicError("PRODUCT_SCAN_TOO_LARGE", "The recognized text is too large."), 413),
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(publicError("INVALID_PRODUCT_SCAN", "The scan text could not be read."), 400);
    }

    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(ProductScanInput)(body).pipe(Effect.result),
    );
    if (decoded._tag === "Failure")
      return c.json(
        publicError(
          "INVALID_PRODUCT_SCAN",
          "Send non-empty recognized text and choose product or batch mode.",
        ),
        400,
      );

    const rateLimit = await c.env.PRODUCT_SCAN_RATE_LIMIT.limit({
      key: `${c.var.organizationId}:${c.var.user.id}`,
    });
    if (!rateLimit.success)
      return c.json(
        publicError("PRODUCT_SCAN_RATE_LIMITED", "Too many scans. Please wait a moment."),
        429,
      );

    try {
      const result = await Effect.runPromise(
        ProductScanService.pipe(
          Effect.flatMap((service) => service.parse(decoded.success)),
          Effect.provide(productScanLayer({ ai: productScanAiClient(c.env.AI, c.req.raw.signal) })),
        ),
      );
      return c.json(result);
    } catch (cause) {
      console.error("Product scan parsing failed", cause instanceof Error ? cause.message : cause);
      return c.json(
        publicError("PRODUCT_SCAN_FAILED", "The recognized text could not be analysed. Try again."),
        502,
      );
    }
  },
);
