import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { InvoiceId } from "../../ids";
import { Invoice } from "../../store/schema";
import { ReadFailure } from "../errors";
import { InvoiceListFilters, InvoiceListRequest } from "../list-request";
import { Stamp } from "../notices";
import { Count, HistoryLimit, HistoryWindow, IdList } from "./shared";

export const IssuedInvoice = Schema.Struct(Struct.pick(Invoice.fields, ["id", "invoiceNumber"]));
export type IssuedInvoice = typeof IssuedInvoice.Type;

export class InvoiceReads extends RpcGroup.make(
  Rpc.make("InvoicePage", {
    payload: InvoiceListRequest,
    success: Schema.Struct({ stamp: Stamp, invoices: Schema.Array(Invoice) }),
    error: ReadFailure,
  }),
  Rpc.make("InvoiceCount", {
    payload: { filters: InvoiceListFilters },
    success: Count,
    error: ReadFailure,
  }),
  Rpc.make("InvoiceById", {
    payload: { id: InvoiceId },
    success: Schema.Struct({ stamp: Stamp, invoice: Schema.NullOr(Invoice) }),
    error: ReadFailure,
  }),
  Rpc.make("InvoiceHistory", {
    payload: { limit: HistoryLimit },
    success: HistoryWindow(Invoice),
    error: ReadFailure,
  }),
  Rpc.make("IssuedInvoices", {
    payload: { ids: IdList(InvoiceId) },
    success: Schema.Struct({ stamp: Stamp, invoices: Schema.Array(IssuedInvoice) }),
    error: ReadFailure,
  }),
) {}
