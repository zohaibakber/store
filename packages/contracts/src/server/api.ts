import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Schema from "effect/Schema";

import { publicErrorSchema } from "../http-errors";
import {
  GlobalProductSearchInput,
  GlobalProductSearchResult,
  InvoiceExtraction,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_INVOICE_UPLOAD_FILES,
  ProductScanInput,
  ProductScanResult,
} from "./schema";

const statusByTag = {
  BadRequest: 400,
  PayloadTooLarge: 413,
  UnsupportedMediaType: 415,
  TooManyRequests: 429,
  BadGateway: 502,
} as const;

export const BadRequest = publicErrorSchema("BadRequest", statusByTag.BadRequest);
export type BadRequest = typeof BadRequest.Type;

export const PayloadTooLarge = publicErrorSchema("PayloadTooLarge", statusByTag.PayloadTooLarge);
export type PayloadTooLarge = typeof PayloadTooLarge.Type;

export const UnsupportedMediaType = publicErrorSchema(
  "UnsupportedMediaType",
  statusByTag.UnsupportedMediaType,
);
export type UnsupportedMediaType = typeof UnsupportedMediaType.Type;

export const TooManyRequests = publicErrorSchema("TooManyRequests", statusByTag.TooManyRequests);
export type TooManyRequests = typeof TooManyRequests.Type;

export const BadGateway = publicErrorSchema("BadGateway", statusByTag.BadGateway);
export type BadGateway = typeof BadGateway.Type;

export const ServerHttpError = Schema.Union([
  BadRequest,
  PayloadTooLarge,
  UnsupportedMediaType,
  TooManyRequests,
  BadGateway,
]);
export type ServerHttpError = typeof ServerHttpError.Type;

export const serverHttpErrorStatus = (tag: ServerHttpError["_tag"]): number => statusByTag[tag];

export const uploadsGroup = HttpApiGroup.make("uploads").add(
  HttpApiEndpoint.post("extract", "/api/uploads", {
    payload: Schema.Unknown.pipe(
      HttpApiSchema.asMultipartStream({
        maxParts: MAX_INVOICE_UPLOAD_FILES + 10,
        maxFileSize: MAX_INVOICE_UPLOAD_BYTES,
        maxTotalSize: MAX_INVOICE_UPLOAD_BYTES,
      }),
    ),
    success: InvoiceExtraction,
    error: [BadRequest, PayloadTooLarge, UnsupportedMediaType, TooManyRequests, BadGateway],
  }),
);

export const productScansGroup = HttpApiGroup.make("productScans").add(
  HttpApiEndpoint.post("parse", "/api/product-scans", {
    payload: ProductScanInput,
    success: ProductScanResult,
    error: [BadRequest, PayloadTooLarge, TooManyRequests, BadGateway],
  }),
);

export const globalSearchGroup = HttpApiGroup.make("globalSearch").add(
  HttpApiEndpoint.post("search", "/api/global-search", {
    payload: GlobalProductSearchInput,
    success: GlobalProductSearchResult,
    error: [BadRequest, TooManyRequests, BadGateway],
  }),
);

export const ServerHttpApi = HttpApi.make("ServerHttpApi").add(
  uploadsGroup,
  productScansGroup,
  globalSearchGroup,
);
