import { InvoiceReads } from "./reads/invoices";
import { ProductReads } from "./reads/products";
import { PurchasingReads } from "./reads/purchasing";
import { SearchReads } from "./reads/search";

export class InventoryReads extends ProductReads.merge(
  InvoiceReads,
  PurchasingReads,
  SearchReads,
) {}
