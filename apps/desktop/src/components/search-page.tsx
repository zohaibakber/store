import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteStatus,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { storeErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";

const SEARCH_DEBOUNCE_MS = 150;

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<Product>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ranking happens in PGlite (trigram + phonetic scoring), so the component
  // never filters locally — hence `filter={null}` on the Autocomplete root.
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      window.offlineStore
        .searchProducts({ query: term, limit: 20 })
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setResults([]);
          setError(storeErrorMessage(cause));
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const openProduct = (product: Product) =>
    void navigate({ to: "/products/$productId", params: { productId: product.id } });

  const status = isSearching ? (
    <span className="flex items-center justify-between gap-2">
      Searching…
      <Spinner className="size-4" />
    </span>
  ) : error ? (
    <span className="text-destructive-foreground">{error}</span>
  ) : results.length === 0 ? (
    <span>No products match “{query.trim()}”.</span>
  ) : (
    `${results.length} ${results.length === 1 ? "product" : "products"} found`
  );

  return (
    <PageLayout contentClassName="max-w-2xl">
      <PageHeader>
        <PageHeading>Search products</PageHeading>
        <PageDescription>
          Fuzzy matching on name and composition — misspellings and partial words still find the
          product.
        </PageDescription>
      </PageHeader>

      <PageContent>
        <Autocomplete
          filter={null}
          items={results as Array<Product>}
          itemToStringValue={(item: unknown) => (item as Product).name}
          onValueChange={setQuery}
          value={query}
        >
          <AutocompleteInput
            aria-label="Search products"
            autoFocus
            placeholder="e.g. Panadol, paracetamol, augmantin…"
            showClear
            size="lg"
            startAddon={<HugeiconsIcon aria-hidden="true" icon={Search01Icon} />}
          />
          {query.trim().length > 0 && (
            <AutocompletePopup aria-busy={isSearching || undefined}>
              <AutocompleteStatus className="text-muted-foreground">{status}</AutocompleteStatus>
              <AutocompleteList>
                {(product: Product) => {
                  const stock = productStock(product);
                  return (
                    <AutocompleteItem
                      className="gap-2"
                      key={product.id}
                      onClick={() => openProduct(product)}
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
          )}
        </Autocomplete>
      </PageContent>
    </PageLayout>
  );
}
