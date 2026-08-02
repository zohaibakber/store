import { ArrowDown01Icon, ArrowUp01Icon, CornerDownLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { prepare, rank } from "@store/persistence/product-ranking";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
import { storeErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import { useStore } from "@/lib/store";

const RESULT_LIMIT = 20;

interface CommandMenuContextValue {
  readonly open: () => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu(): CommandMenuContextValue {
  const context = useContext(CommandMenuContext);
  if (!context) throw new Error("useCommandMenu must be used within a CommandMenuProvider");
  return context;
}

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ReadonlyArray<Product>>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const store = useStore();

  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      event.preventDefault();
      setIsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The catalog is local, so it loads whole and ranking runs here rather than
  // round-tripping a query to the store on every keystroke.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    store
      .listProducts()
      .then((loaded) => {
        if (cancelled) return;
        setProducts(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(storeErrorMessage(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, store]);

  const prepared = useMemo(() => products.map(prepare), [products]);

  const results = useMemo(() => {
    const term = query.trim();
    if (term.length === 0) return products.slice(0, RESULT_LIMIT);
    return rank(prepared, term, RESULT_LIMIT).map((entry) => entry.product);
  }, [prepared, products, query]);

  const handleOpenProduct = (product: Product) => {
    setIsOpen(false);
    setQuery("");
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };

  return (
    <CommandMenuContext.Provider value={{ open }}>
      {children}
      <CommandDialog open={isOpen} onOpenChange={handleOpenChange}>
        <CommandDialogPopup aria-label="Search products">
          <Command
            filter={null}
            items={results as Array<Product>}
            itemToStringValue={(item: unknown) => (item as Product).name}
            onValueChange={setQuery}
            value={query}
          >
            <CommandInput placeholder="Search products…" />
            <CommandPanel>
              <CommandEmpty>
                {error ?? (products.length === 0 ? "No products yet." : "No products found.")}
              </CommandEmpty>
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
                      <span className="flex-1 truncate capitalize">
                        {product.name}
                        {product.strength && (
                          <span className="ml-1 text-muted-foreground">{product.strength}</span>
                        )}
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
        </CommandDialogPopup>
      </CommandDialog>
    </CommandMenuContext.Provider>
  );
}
