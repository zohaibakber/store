import {
  containsText,
  type ReplicaSubsetReader,
  type ReplicaSummaryReader,
  type SubsetPredicate,
} from "@store/client-db";
import * as Effect from "effect/Effect";

import { WorkspaceReadFailure } from "./errors";
import { countRows, readPageIds } from "./list-page";
import { MAX_LIST_SEARCH_LENGTH, type InvoiceSortColumn, type ListPage } from "./list-request";

export type InvoiceListFilters = {
  readonly customer?: string;
};

export type InvoiceListRequest = ListPage<InvoiceSortColumn> & {
  readonly filters: InvoiceListFilters;
};

const invoiceListWhere = (filters: InvoiceListFilters): SubsetPredicate | undefined => {
  const customer = (filters.customer ?? "").trim().slice(0, MAX_LIST_SEARCH_LENGTH);
  return customer === "" ? undefined : containsText("customerName", customer);
};

const readFailure = () =>
  new WorkspaceReadFailure({ message: "Could not read invoices on this device." });

export const readInvoicePageIds = (
  reader: ReplicaSubsetReader,
  request: InvoiceListRequest,
): Effect.Effect<ReadonlyArray<string>, WorkspaceReadFailure> =>
  readPageIds(reader, "invoices", invoiceListWhere(request.filters), request, readFailure).pipe(
    Effect.withSpan("InvoiceList.readPage"),
  );

export const countInvoices = (
  reader: ReplicaSummaryReader,
  filters: InvoiceListFilters,
): Effect.Effect<number, WorkspaceReadFailure> =>
  countRows(reader, "invoices", invoiceListWhere(filters), readFailure).pipe(
    Effect.withSpan("InvoiceList.count"),
  );
