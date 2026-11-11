import type {
  InvoiceListFilters as InvoiceFiltersPayload,
  InvoiceListRequest as InvoicePagePayload,
} from "@store/contracts/replica";

import { boundedPage, boundedText, type InvoiceSortColumn, type ListPage } from "./list-request";

export type { IssuedInvoice } from "@store/contracts/replica";

export type InvoiceListFilters = {
  readonly customer?: string;
};

export type InvoiceListRequest = ListPage<InvoiceSortColumn> & {
  readonly filters: InvoiceListFilters;
};

export const invoiceFiltersPayload = (filters: InvoiceListFilters): InvoiceFiltersPayload => {
  const customer = boundedText(filters.customer?.trim());
  return customer === "" ? {} : { customer };
};

export const invoicePagePayload = (request: InvoiceListRequest): InvoicePagePayload => ({
  ...boundedPage(request),
  filters: invoiceFiltersPayload(request.filters),
});
