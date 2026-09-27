import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { Suspense, useDeferredValue, useState } from "react";

import { useInvoiceCreate } from "@/components/invoices/create-context";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSuspenseProductSearch } from "@/lib/inventory";

const RESULT_LIMIT = 20;

function InvoiceProductPicker() {
  const {
    state: { pickerKey },
    actions: { addProduct },
  } = useInvoiceCreate();
  return (
    <Suspense fallback={<Skeleton className="h-9 w-full" />}>
      <ProductPickerSearch key={pickerKey} onPick={addProduct} />
    </Suspense>
  );
}

function ProductPickerSearch({ onPick }: { readonly onPick: (product: Product) => void }) {
  const [query, setQuery] = useState("");
  const searchQuery = useDeferredValue(query);
  const products = useSuspenseProductSearch(searchQuery.trim(), RESULT_LIMIT);

  return (
    <Autocomplete
      filter={null}
      items={[...products]}
      itemToStringValue={(item) => item.name}
      onValueChange={setQuery}
      value={query}
    >
      <AutocompleteInput
        autoFocus
        aria-label="Search products"
        placeholder="Search products to add…"
        showClear
        showTrigger
        startAddon={<HugeiconsIcon aria-hidden="true" icon={Search01Icon} />}
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No matching products.</AutocompleteEmpty>
        <AutocompleteList>
          {(product: Product) => {
            const stock = productStock(product);
            return (
              <AutocompleteItem key={product.id} onClick={() => onPick(product)} value={product}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate capitalize">
                    {product.name}
                    {product.strength && (
                      <span className="ml-1 text-muted-foreground">{product.strength}</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.category.name}
                  </span>
                </span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {formatPrice(product.unitPrice)}
                </span>
                <Badge variant={stock === 0 ? "outline" : "secondary"}>
                  {stock === 0 ? "Out of stock" : `${stock} in stock`}
                </Badge>
              </AutocompleteItem>
            );
          }}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}

export { InvoiceProductPicker };
