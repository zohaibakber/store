import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { Suspense, useDeferredValue, useEffect, useRef, useState } from "react";

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
import { formatNumber } from "@/lib/format";
import { useSuspenseProductSearch } from "@/lib/inventory";
import { SALE_SEARCH_LIMIT } from "@/lib/sale-drafts";
import { isEditableTarget, isInListbox } from "@/lib/shortcuts";

function InvoiceProductPicker() {
  const {
    actions: { addProduct, focusSearch },
  } = useInvoiceCreate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && isInListbox(event.target)) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  return (
    <div className="flex flex-col gap-1.5">
      <Suspense fallback={<LoadingSpinner className="h-9" />}>
        <ProductPickerSearch onPick={addProduct} />
      </Suspense>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
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
    state: { lines },
    meta: { searchRef },
  } = useInvoiceCreate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingRecent, setPendingRecent] = useState<{
    readonly id: string;
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
          onFocus={() => {
            if (!query && lines.length === 0 && recents.length > 0) setOpen(true);
          }}
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
        <AutocompletePopup>
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
      <span className="min-w-0 truncate capitalize">{name}</span>
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

export { InvoiceProductPicker };
