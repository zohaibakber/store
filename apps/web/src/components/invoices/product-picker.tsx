import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";

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
import { formatPrice } from "@/lib/format";

const matches = (product: Product, query: string) => {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return true;
  return (
    product.name.toLowerCase().includes(term) ||
    (product.composition?.toLowerCase().includes(term) ?? false)
  );
};

function InvoiceProductPicker() {
  const {
    state: { pickerKey },
    actions: { addProduct },
    meta: { products },
  } = useInvoiceCreate();

  return (
    <Autocomplete
      filter={matches}
      items={[...products]}
      itemToStringValue={(item) => item.name}
      key={pickerKey}
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
              <AutocompleteItem
                className="gap-2"
                key={product.id}
                onClick={() => addProduct(product)}
                value={product}
              >
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
