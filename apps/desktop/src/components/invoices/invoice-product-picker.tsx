import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts";

import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";

function InvoiceProductPicker() {
  const {
    state: { pickerKey },
    actions: { addProduct },
    meta: { products },
  } = useInvoiceCreate();

  return (
    <Combobox
      key={pickerKey}
      items={products as Product[]}
      itemToStringLabel={(product: Product) => product.name}
      onValueChange={(product: Product | null) => product && addProduct(product)}
    >
      <ComboboxInput autoFocus className="w-full" placeholder="Search products…" />
      <ComboboxContent>
        <ComboboxEmpty>No matching products.</ComboboxEmpty>
        <ComboboxList>
          {(product: Product) => {
            const stock = productStock(product);
            return (
              <ComboboxItem key={product.id} value={product}>
                <span className="flex-1 truncate">
                  {product.name}
                  {product.strength && (
                    <span className="ml-1 text-muted-foreground">{product.strength}</span>
                  )}
                </span>
                <Badge className="mr-5" variant={stock === 0 ? "outline" : "secondary"}>
                  {stock === 0 ? "Out of stock" : `${stock} in stock`}
                </Badge>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export { InvoiceProductPicker };
