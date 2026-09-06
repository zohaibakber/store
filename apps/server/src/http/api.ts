import {
  CatalogWriteCommand,
  ImportInventoryCommand,
  ImportInventoryCommandResult,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  InvoiceExtraction,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_INVOICE_UPLOAD_FILES,
  ProductScanInput,
  ProductScanResult,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import { OrganizationAuth } from "../auth/organization";
import {
  BadGateway,
  BadRequest,
  Conflict,
  Forbidden,
  PayloadTooLarge,
  TooManyRequests,
  UnsupportedMediaType,
} from "./errors";

export const MAX_UPLOAD_FILES = MAX_INVOICE_UPLOAD_FILES;
export const MAX_UPLOAD_BYTES = MAX_INVOICE_UPLOAD_BYTES;

const Landing = Schema.Struct({
  service: Schema.Literal("Store Invoice API"),
  endpoints: Schema.Array(Schema.String),
});

const ApiStatus = Schema.Struct({
  service: Schema.Literal("Store Invoice API"),
  ok: Schema.Boolean,
});

const Health = Schema.Struct({ ok: Schema.Boolean });

const system = HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("landing", "/", { success: Landing }))
  .add(HttpApiEndpoint.get("status", "/api", { success: ApiStatus }))
  .add(HttpApiEndpoint.get("health", "/api/health", { success: Health }));

const uploads = HttpApiGroup.make("uploads").add(
  HttpApiEndpoint.post("extract", "/api/uploads", {
    payload: Schema.Unknown.pipe(
      HttpApiSchema.asMultipartStream({
        maxParts: MAX_UPLOAD_FILES + 10,
        maxFileSize: MAX_UPLOAD_BYTES,
        maxTotalSize: MAX_UPLOAD_BYTES,
      }),
    ),
    success: InvoiceExtraction,
    error: [BadRequest, PayloadTooLarge, UnsupportedMediaType, TooManyRequests, BadGateway],
  }).middleware(OrganizationAuth),
);

const productScans = HttpApiGroup.make("productScans").add(
  HttpApiEndpoint.post("parse", "/api/product-scans", {
    payload: ProductScanInput,
    success: ProductScanResult,
    error: [BadRequest, PayloadTooLarge, TooManyRequests, BadGateway],
  }).middleware(OrganizationAuth),
);

const InventoryMutationResult = Schema.Struct({
  txid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

const inventoryMutations = HttpApiGroup.make("inventoryMutations")
  .add(
    HttpApiEndpoint.post("write", "/api/inventory/mutations", {
      payload: CatalogWriteCommand,
      success: InventoryMutationResult,
      error: [BadRequest, Forbidden, Conflict],
    }).middleware(OrganizationAuth),
  )
  .add(
    HttpApiEndpoint.post("importInventory", "/api/inventory/imports", {
      payload: ImportInventoryCommand,
      success: ImportInventoryCommandResult,
      error: [BadRequest, Forbidden, Conflict],
    }).middleware(OrganizationAuth),
  )
  .add(
    HttpApiEndpoint.post("issueInvoice", "/api/inventory/invoices", {
      payload: IssueInvoiceCommand,
      success: IssueInvoiceResult,
      error: [BadRequest, Forbidden, Conflict],
    }).middleware(OrganizationAuth),
  );

export const StoreApi = HttpApi.make("StoreApi").add(
  system,
  uploads,
  productScans,
  inventoryMutations,
);
