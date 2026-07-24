import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { formatPrice } from "@/lib/format";

// The catalog is already in memory from the route loader, so matching happens
// here rather than through the store's fuzzy search.
const matches = (itemValue: unknown, query: string) => {
  const product = itemValue as Product;
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
      items={products as Product[]}
      itemToStringValue={(item: unknown) => (item as Product).name}
      key={pickerKey}
    >
      <AutocompleteInput
        autoFocus
        aria-label="Search products"
        placeholder="Search products to add…"
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
                <span className="flex-1 truncate">
                  {product.name}
                  {product.strength && (
                    <span className="ml-1 text-muted-foreground">{product.strength}</span>
                  )}
                </span>
                <span className="text-muted-foreground tabular-nums">
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
