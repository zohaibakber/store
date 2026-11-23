import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product, ProductId } from "@store/contracts";
import { productStock } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { Suspense, useDeferredValue, useRef, useState } from "react";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import { useInvoiceCreate } from "@/components/invoices/create-context";
import { ProductResolver } from "@/components/invoices/resolve-product";
import { parseSaleQuery } from "@/components/invoices/sale-query";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteStatus,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { useRecentProducts, type RecentProduct } from "@/hooks/use-recent-products";
import { useSuspenseCatalogProduct, useSuspenseProductSearch } from "@/inventory/queries";
import { formatNumber } from "@/lib/format";
import { SALE_SEARCH_LIMIT } from "@/lib/sale-drafts";
import { isEditableTarget, isInListbox, useWindowKeydown } from "@/lib/shortcuts";

function InvoiceProductPicker() {
  const {
    actions: { addProduct, focusSearch },
  } = useInvoiceCreate();

  useWindowKeydown((event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented) return;
    if (isInListbox(event.target) || isEditableTarget(event.target)) return;
    event.preventDefault();
    focusSearch();
  });

  return (
    <div className="group/picker flex flex-col gap-1.5">
      <Suspense fallback={<LoadingSpinner className="h-9" />}>
        <ProductPickerSearch onPick={addProduct} />
      </Suspense>
      <p className="invisible flex items-center gap-1 text-xs text-muted-foreground group-focus-within/picker:visible">
        Type <Kbd>3*</Kbd> before a name to add 3 at once.
      </p>
    </div>
  );
}

type PickerItem =
  | { readonly kind: "product"; readonly product: Product }
  | { readonly kind: "recent"; readonly recent: RecentProduct };

const itemId = (item: PickerItem) => (item.kind === "product" ? item.product.id : item.recent.id);

function ProductPickerSearch({
  onPick,
}: {
  readonly onPick: (product: Product, quantity: number) => void;
}) {
  const {
    meta: { searchRef },
  } = useInvoiceCreate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingRecent, setPendingRecent] = useState<{
    readonly id: ProductId;
    readonly quantity: number;
    readonly nonce: number;
  } | null>(null);
  const nonceRef = useRef(0);
  const recents = useRecentProducts();
  const { quantity, term } = parseSaleQuery(query);
  const searchTerm = useDeferredValue(term);
  const products = useSuspenseProductSearch(searchTerm, SALE_SEARCH_LIMIT);
  const isStale = searchTerm !== term;
  const items: ReadonlyArray<PickerItem> = term
    ? products.map((product) => ({ kind: "product", product }))
    : recents.map((recent) => ({ kind: "recent", recent }));

  const pick = (item: PickerItem) => {
    if (item.kind === "product") onPick(item.product, quantity);
    else setPendingRecent({ id: item.recent.id, quantity, nonce: nonceRef.current++ });
    setQuery("");
  };

  return (
    <>
      {pendingRecent && (
        <ProductResolver
          key={pendingRecent.nonce}
          onResolve={(product) => {
            if (product) onPick(product, pendingRecent.quantity);
            setPendingRecent(null);
          }}
          productId={pendingRecent.id}
        />
      )}
      <Autocomplete
        autoHighlight="always"
        filter={null}
        items={items}
        itemToStringValue={(item) =>
          item.kind === "product" ? item.product.name : item.recent.name
        }
        onOpenChange={setOpen}
        onValueChange={(value, details) => {
          if (details.reason !== "item-press") setQuery(value);
        }}
        open={open && (items.length > 0 || term !== "")}
        value={query}
      >
        <AutocompleteInput
          autoFocus
          aria-keyshortcuts="/"
          aria-label="Search products"
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              setQuery("");
              return;
            }
            if (event.key === "Enter" && term && isStale) {
              event.preventDefault();
              event.preventBaseUIHandler();
            }
          }}
          placeholder="Search products to add…"
          ref={searchRef}
          showClear
          startAddon={<HugeiconsIcon aria-hidden="true" icon={Search01Icon} />}
        />
        <AutocompletePopup className="max-w-(--anchor-width) *:min-w-0">
          {!term && <AutocompleteStatus>Recent products</AutocompleteStatus>}
          <AutocompleteEmpty>No matching products.</AutocompleteEmpty>
          <AutocompleteList>
            {(item: PickerItem) => (
              <AutocompleteItem key={itemId(item)} onClick={() => pick(item)} value={item}>
                {item.kind === "product" ? (
                  <ProductOption product={item.product} />
                ) : (
                  <ProductName
                    categoryName={item.recent.categoryName}
                    name={item.recent.name}
                    strength={item.recent.strength}
                  />
                )}
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>
    </>
  );
}

function ProductName({
  categoryName,
  name,
  strength,
}: {
  readonly categoryName: string;
  readonly name: string;
  readonly strength: string | null;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="min-w-0 truncate">{name}</span>
      {strength && <span className="shrink-0 text-muted-foreground">{strength}</span>}
      <span className="min-w-0 flex-1 basis-0 truncate text-xs text-muted-foreground">
        {categoryName}
      </span>
    </span>
  );
}

function ProductOption({ product }: { readonly product: Product }) {
  const stock = productStock(product);
  return (
    <>
      <ProductName
        categoryName={product.category.name}
        name={product.name}
        strength={product.strength}
      />
      <span className="ms-3 text-muted-foreground tabular-nums">
        {formatPrice(product.unitPrice)}
      </span>
      <span className="ms-3 flex w-24 justify-end">
        <Badge variant={stock === 0 ? "outline" : "secondary"}>
          {stock === 0 ? "Out of stock" : `${formatNumber(stock)} in stock`}
        </Badge>
      </span>
    </>
  );
}

const CHIP_CLASS =
  "inline-flex h-8 max-w-64 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm outline-none";

function RecentChipLabel({
  recent,
  note,
}: {
  readonly recent: RecentProduct;
  readonly note?: string;
}) {
  return (
    <>
      <span className="truncate">{recent.name}</span>
      {recent.strength && <span className="shrink-0 text-muted-foreground">{recent.strength}</span>}
      {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
    </>
  );
}

function RecentChip({ recent }: { readonly recent: RecentProduct }) {
  const {
    actions: { addProduct },
  } = useInvoiceCreate();
  const product = useSuspenseCatalogProduct(recent.id);
  if (!product) return null;
  if (productStock(product) <= 0) {
    return (
      <li>
        <span aria-disabled="true" className={`${CHIP_CLASS} opacity-64`}>
          <RecentChipLabel
            note={product.batches.length === 0 ? "Not stocked" : "Out of stock"}
            recent={recent}
          />
        </span>
      </li>
    );
  }
  return (
    <li>
      <button
        className={`${CHIP_CLASS} hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring`}
        onClick={() => addProduct(product, 1)}
        type="button"
      >
        <RecentChipLabel recent={recent} />
      </button>
    </li>
  );
}

/**
 * The empty cart: the last products sold, one click from the cart, so the
 * search popup never has to open over the page by itself.
 */
function RecentProductsQuickAdd() {
  const recents = useRecentProducts();

  if (recents.length === 0) {
    return (
      <p className="py-6 text-center text-muted-foreground">
        No items yet. Search above and press Enter to add.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 py-3">
      <p className="text-xs text-muted-foreground">No items yet. Add a recent product:</p>
      <ul aria-label="Recent products" className="flex flex-wrap gap-1.5">
        {recents.map((recent) => (
          <Suspense
            fallback={
              <li>
                <span className={CHIP_CLASS}>
                  <RecentChipLabel recent={recent} />
                </span>
              </li>
            }
            key={recent.id}
          >
            <RecentChip recent={recent} />
          </Suspense>
        ))}
      </ul>
    </div>
  );
}

export { InvoiceProductPicker, RecentProductsQuickAdd };
