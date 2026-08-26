import { ArrowDown01Icon, ArrowUp01Icon, CornerDownLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

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
import { formatPrice } from "@/lib/format";
import { useCatalogProducts, useInventoryState } from "@/lib/inventory-db";
import { Route as RootRoute } from "@/routes/__root";

const RESULT_LIMIT = 20;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();

const trigrams = (value: string) => {
  const result = new Set<string>();
  for (const word of normalize(value)
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)) {
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      result.add(padded.slice(index, index + 3));
    }
  }
  return result;
};

const similarity = (left: ReadonlySet<string>, right: ReadonlySet<string>) => {
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
};

interface PreparedProduct {
  readonly product: Product;
  readonly name: string;
  readonly composition: string;
  readonly nameTrigrams: ReadonlySet<string>;
  readonly compositionTrigrams: ReadonlySet<string>;
}

const prepareProduct = (product: Product): PreparedProduct => ({
  product,
  name: normalize(product.name),
  composition: normalize(product.composition ?? ""),
  nameTrigrams: trigrams(product.name),
  compositionTrigrams: trigrams(product.composition ?? ""),
});

const rankProducts = (
  products: ReadonlyArray<PreparedProduct>,
  rawQuery: string,
): ReadonlyArray<Product> => {
  const query = normalize(rawQuery.trim());
  const queryTrigrams = trigrams(query);
  return products
    .flatMap((entry) => {
      const nameSimilarity = similarity(entry.nameTrigrams, queryTrigrams);
      const compositionSimilarity = similarity(entry.compositionTrigrams, queryTrigrams);
      const startsWithName = entry.name.startsWith(query);
      const containsName = entry.name.includes(query);
      const containsComposition = entry.composition.includes(query);
      if (
        !startsWithName &&
        !containsName &&
        !containsComposition &&
        nameSimilarity <= 0.15 &&
        compositionSimilarity <= 0.2
      ) {
        return [];
      }
      return [
        {
          product: entry.product,
          score:
            nameSimilarity +
            compositionSimilarity * 0.5 +
            (startsWithName ? 1 : 0) +
            (containsName ? 0.5 : 0) +
            (containsComposition ? 0.25 : 0),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.product.name.localeCompare(right.product.name),
    )
    .slice(0, RESULT_LIMIT)
    .map((entry) => entry.product);
};

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
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") return null;
  return <ProductCommandMenu inventory={state.inventory} onOpenChange={onOpenChange} />;
}

function ProductCommandMenu({
  inventory,
  onOpenChange,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const products = useCatalogProducts(inventory);
  const normalizedQuery = query.trim();

  const prepared = useMemo(
    () => (normalizedQuery.length >= 2 ? products.data.map(prepareProduct) : []),
    [normalizedQuery.length, products.data],
  );
  const results = useMemo(() => {
    if (normalizedQuery.length === 0) return products.data.slice(0, RESULT_LIMIT);
    if (normalizedQuery.length < 2) {
      const term = normalize(normalizedQuery);
      return products.data
        .filter(
          (product) =>
            normalize(product.name).includes(term) ||
            normalize(product.composition ?? "").includes(term),
        )
        .slice(0, RESULT_LIMIT);
    }
    return rankProducts(prepared, normalizedQuery);
  }, [normalizedQuery, prepared, products.data]);

  const handleOpenProduct = (product: Product) => {
    onOpenChange(false);
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  };

  const emptyMessage =
    products.isError && products.data.length === 0
      ? "Product search could not be loaded."
      : products.data.length === 0
        ? "No products yet."
        : "No products found.";

  return (
    <Command
      autoHighlight="always"
      filter={null}
      inline
      items={[...results]}
      itemToStringValue={(item) => item.name}
      keepHighlight
      onValueChange={setQuery}
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
                className="gap-2"
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
