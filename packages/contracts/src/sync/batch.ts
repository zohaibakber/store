import * as Schema from "effect/Schema";

import { CatalogWriteCommand } from "../catalog/write";
import { ImportInventoryCommand, IssueInvoiceCommand } from "../store/schema";
import { CatalogCursor } from "./schema";

export const SYNC_EPOCH = 2;
export const SYNC_PAGE_ROWS = 50;
export const SYNC_PAGE_BYTES = 512 * 1024;
export const SYNC_BATCH_BYTES = 256 * 1024;
export const CatalogBatchCommand = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("catalogWrite"), command: CatalogWriteCommand }),
  Schema.Struct({ kind: Schema.Literal("issueInvoice"), command: IssueInvoiceCommand }),
  Schema.Struct({ kind: Schema.Literal("importInventory"), command: ImportInventoryCommand }),
]);
export type CatalogBatchCommand = typeof CatalogBatchCommand.Type;
export const CatalogBatchRequest = Schema.Struct({
  commands: Schema.Array(CatalogBatchCommand).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});
export type CatalogBatchRequest = typeof CatalogBatchRequest.Type;
export const CatalogBatchResult = Schema.Struct({
  results: Schema.Array(
    Schema.Union([
      Schema.Struct({ status: Schema.Literal("accepted"), id: Schema.String, txid: CatalogCursor }),
      Schema.Struct({
        status: Schema.Literal("rejected"),
        id: Schema.String,
        code: Schema.String,
        message: Schema.String,
      }),
    ]),
  ),
});
export type CatalogBatchResult = typeof CatalogBatchResult.Type;
export const CatalogLiveTicket = Schema.Struct({
  ticket: Schema.String,
  organizationId: Schema.String,
  expiresAt: Schema.Number,
});
export const CatalogNotification = Schema.Struct({ epoch: Schema.Number, cursor: CatalogCursor });
