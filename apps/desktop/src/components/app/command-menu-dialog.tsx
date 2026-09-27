import { ArrowDown01Icon, ArrowUp01Icon, CornerDownLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useAuth } from "@/lib/auth";
import { useCatalogIsReady, useSuspenseProductSearch } from "@/lib/inventory";
import { Route as RootRoute } from "@/routes/__root";

const RESULT_LIMIT = 20;

export function InventoryCommandDialog({
  onOpenChange,
}: {
  readonly onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  const { access, inventory } = RootRoute.useRouteContext();
  const scope = access.inventoryScope(auth.snapshot);

  return (
    <CommandDialog onOpenChange={onOpenChange} open>
      <CommandDialogPopup aria-label="Search products">
        {!inventory ? (
          <p className="p-6 text-sm text-destructive">Product search is unavailable.</p>
        ) : !scope ? (
          <p className="p-6 text-sm text-destructive">Product search workspace is unavailable.</p>
        ) : (
          <LiveCommandMenu onOpenChange={onOpenChange} />
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function LiveCommandMenu({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const catalogReady = useCatalogIsReady();
  if (!catalogReady) return null;
  return <ProductCommandMenu onOpenChange={onOpenChange} />;
}

function ProductCommandMenu({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const searchQuery = useDeferredValue(query);
  return (
    <ProductCommandResults
      onOpenChange={onOpenChange}
      onQueryChange={setQuery}
      query={query}
      searchQuery={searchQuery}
    />
  );
}

function ProductCommandResults({
  onOpenChange,
  onQueryChange,
  query,
  searchQuery,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onQueryChange: (query: string) => void;
  readonly query: string;
  readonly searchQuery: string;
}) {
  const navigate = useNavigate();
  const results = useSuspenseProductSearch(searchQuery.trim(), RESULT_LIMIT);

  const handleOpenProduct = (product: Product) => {
    onOpenChange(false);
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  };

  const emptyMessage = searchQuery.trim() === "" ? "No products yet." : "No products found.";

  return (
    <Command
      autoHighlight="always"
      filter={null}
      inline
      items={[...results]}
      itemToStringValue={(item) => item.name}
      keepHighlight
      onValueChange={onQueryChange}
      open
      value={query}
    >
      <CommandInput placeholder="Search products…" />
      <CommandPanel>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandList>
          {(product: Product) => {
            const stock = productStock(product);
            return (
              <CommandItem
                key={product.id}
                onClick={() => handleOpenProduct(product)}
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
              </CommandItem>
            );
          }}
        </CommandList>
      </CommandPanel>
      <CommandFooter>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>
                <HugeiconsIcon aria-hidden="true" icon={ArrowUp01Icon} />
              </Kbd>
              <Kbd>
                <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
              </Kbd>
            </KbdGroup>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>
              <HugeiconsIcon aria-hidden="true" icon={CornerDownLeftIcon} />
            </Kbd>
            <span>Open</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Kbd>Esc</Kbd>
          <span>Close</span>
        </div>
      </CommandFooter>
    </Command>
  );
}
