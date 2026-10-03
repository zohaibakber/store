import type { IconSvgElement } from "@hugeicons/react";
import type { Invoice, Product } from "@store/contracts";
import {
  MAX_GLOBAL_SEARCH_QUERY_LENGTH,
  MIN_GLOBAL_SEARCH_QUERY_LENGTH,
  type GlobalProduct,
} from "@store/contracts/server-api.schema";

import type { GlobalSearchView } from "@/hooks/use-global-product-search";
import type { RecentProduct } from "@/hooks/use-recent-products";

export const PRODUCT_LIMIT = 30;
const ALL_PRODUCT_LIMIT = 8;
const ALL_INVOICE_LIMIT = 5;
const INVOICE_LIMIT = 30;
export const INVOICE_WINDOW = 200;
const SUGGESTED_ACTION_IDS = ["new-sale", "add-product", "go-products", "go-invoices"];

export type Scope = "all" | "products" | "invoices" | "actions" | "global";

export type CatalogScope = Exclude<Scope, "global">;

export const SCOPES: ReadonlyArray<{ readonly value: CatalogScope; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "products", label: "Products" },
  { value: "invoices", label: "Invoices" },
  { value: "actions", label: "Actions" },
];

export const PLACEHOLDERS = {
  all: "Search products, invoices, and actions…",
  products: "Search products…",
  invoices: "Search invoices by number or customer…",
  actions: "Search actions…",
  global: "Search products on the web…",
} satisfies Record<Scope, string>;

export type ProductTarget = {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly category: { readonly name: string };
};

export type ActionEntry = {
  readonly kind: "action";
  readonly id: string;
  readonly label: string;
  readonly keywords: string;
  readonly icon: IconSvgElement;
  readonly shortcut?: string;
  readonly run: () => void;
};

export type Entry =
  | { readonly kind: "product"; readonly id: string; readonly product: Product }
  | { readonly kind: "recent"; readonly id: string; readonly recent: RecentProduct }
  | { readonly kind: "invoice"; readonly id: string; readonly invoice: Invoice }
  | { readonly kind: "global"; readonly id: string; readonly product: GlobalProduct }
  | ActionEntry;

export type EntryGroup = { readonly value: string; readonly items: ReadonlyArray<Entry> };

export type Page =
  | { readonly kind: "root" }
  | { readonly kind: "product"; readonly target: ProductTarget };

export const ROOT_PAGE: Page = { kind: "root" };

export const recentTarget = (recent: RecentProduct): ProductTarget => ({
  id: recent.id,
  name: recent.name,
  strength: recent.strength,
  category: { name: recent.categoryName },
});

export const entryTarget = (entry: Entry | undefined): ProductTarget | undefined => {
  if (entry?.kind === "product") return entry.product;
  if (entry?.kind === "recent") return recentTarget(entry.recent);
  return undefined;
};

export const productLabel = (target: ProductTarget) =>
  target.strength ? `${target.name} ${target.strength}` : target.name;

export const WEB_SEARCH_ACTION_ID = "search-the-web";

export const webSearchLabel = (trimmed: string) => `Search the web for “${trimmed}”`;

export const globalProductDetails = (product: GlobalProduct) =>
  [
    product.composition,
    product.manufacturer,
    product.unitsPerPack === null ? null : `${product.unitsPerPack} per pack`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

export const globalProductPrefill = (product: GlobalProduct) => ({
  name: product.name,
  composition: product.composition ?? undefined,
  strength: product.strength ?? undefined,
  unitsPerPack: product.unitsPerPack ?? undefined,
});

const tokensOf = (query: string) => query.toLowerCase().split(/\s+/u).filter(Boolean);

const matchesAction = (action: ActionEntry, tokens: ReadonlyArray<string>) => {
  const haystack = `${action.label} ${action.keywords}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
};

const matchInvoices = (invoices: ReadonlyArray<Invoice>, query: string, limit: number) => {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return invoices.slice(0, limit);
  const number = trimmed.replace(/^#/u, "");
  const numeric = /^\d+$/u.test(number);
  const matches = invoices.filter((invoice) =>
    numeric
      ? String(invoice.invoiceNumber).startsWith(number)
      : (invoice.customerName ?? "").toLowerCase().includes(trimmed),
  );
  return matches.slice(0, limit);
};

export const searchesInvoices = (page: Page, scope: Scope, trimmed: string) =>
  page.kind === "root" && (scope === "invoices" || (scope === "all" && trimmed !== ""));

export const pageGroups = (
  actions: ReadonlyArray<ActionEntry>,
  query: string,
): ReadonlyArray<EntryGroup> => {
  const tokens = tokensOf(query);
  return [{ value: "Actions", items: actions.filter((action) => matchesAction(action, tokens)) }];
};

export const rootGroups = (input: {
  readonly scope: Scope;
  readonly trimmed: string;
  readonly products: ReadonlyArray<Product>;
  readonly recents: ReadonlyArray<RecentProduct>;
  readonly invoices: ReadonlyArray<Invoice>;
  readonly actions: ReadonlyArray<ActionEntry>;
  readonly global: GlobalSearchView;
  readonly webSearch: ActionEntry | null;
}): ReadonlyArray<EntryGroup> => {
  const { scope, trimmed, products, recents, invoices, actions, global, webSearch } = input;
  const tokens = tokensOf(trimmed);
  const productEntries = (limit: number): ReadonlyArray<Entry> =>
    products.slice(0, limit).map((product) => ({ kind: "product", id: product.id, product }));
  const recentEntries: ReadonlyArray<Entry> = recents.map((recent) => ({
    kind: "recent",
    id: recent.id,
    recent,
  }));
  const invoiceEntries = (limit: number): ReadonlyArray<Entry> =>
    matchInvoices(invoices, trimmed, limit).map((invoice) => ({
      kind: "invoice",
      id: invoice.id,
      invoice,
    }));
  const actionEntries = actions.filter((action) => matchesAction(action, tokens));
  const webSearchEntries: ReadonlyArray<Entry> = webSearch ? [webSearch] : [];
  const globalEntries = (): ReadonlyArray<Entry> => {
    switch (global._tag) {
      case "Results":
        return global.products.map((product, index) => ({
          kind: "global",
          id: `global-${index}-${product.sourceUrl}`,
          product,
        }));
      case "Ready":
        return webSearchEntries;
      case "SignedOut":
      case "Offline":
      case "Empty":
      case "TooShort":
      case "TooLong":
      case "Searching":
        return [];
    }
  };

  const all: ReadonlyArray<EntryGroup> =
    scope === "all"
      ? trimmed === ""
        ? [
            { value: "Recent", items: recentEntries },
            {
              value: "Suggested",
              items: actions.filter((action) => SUGGESTED_ACTION_IDS.includes(action.id)),
            },
          ]
        : [
            { value: "Products", items: productEntries(ALL_PRODUCT_LIMIT) },
            { value: "Invoices", items: invoiceEntries(ALL_INVOICE_LIMIT) },
            { value: "Actions", items: actionEntries },
            { value: "Global", items: webSearchEntries },
          ]
      : scope === "products"
        ? trimmed === ""
          ? [
              { value: "Recent", items: recentEntries },
              {
                value: "Products",
                items: productEntries(PRODUCT_LIMIT).filter(
                  (entry) => !recents.some((recent) => recent.id === entry.id),
                ),
              },
            ]
          : [{ value: "Products", items: productEntries(PRODUCT_LIMIT) }]
        : scope === "invoices"
          ? [
              {
                value: trimmed === "" ? "Latest invoices" : "Invoices",
                items: invoiceEntries(INVOICE_LIMIT),
              },
            ]
          : scope === "actions"
            ? [{ value: "Actions", items: actionEntries }]
            : [{ value: "Global", items: globalEntries() }];
  return all.filter((group) => group.items.length > 0);
};

const globalEmptyMessage = (global: GlobalSearchView, trimmed: string): string | null => {
  switch (global._tag) {
    case "SignedOut":
      return "Sign in to search products on the web.";
    case "Offline":
      return "You're offline. Connect to search the web.";
    case "Empty":
      return "Type a product name, then press Enter to search the web.";
    case "TooShort":
      return `Type at least ${MIN_GLOBAL_SEARCH_QUERY_LENGTH} characters to search the web.`;
    case "TooLong":
      return `Shorten the search to ${MAX_GLOBAL_SEARCH_QUERY_LENGTH} characters or fewer.`;
    case "Results":
      return `No products found on the web for “${trimmed}”.`;
    case "Ready":
    case "Searching":
      return null;
  }
};

export const emptyMessage = (
  page: Page,
  scope: Scope,
  trimmed: string,
  global: GlobalSearchView,
): string | null =>
  page.kind === "product"
    ? "No matching actions."
    : scope === "global"
      ? globalEmptyMessage(global, trimmed)
      : trimmed === ""
        ? scope === "invoices"
          ? "No invoices yet."
          : "Type to search products."
        : scope === "invoices"
          ? "No invoices found."
          : scope === "actions"
            ? "No actions found."
            : "No results found.";
