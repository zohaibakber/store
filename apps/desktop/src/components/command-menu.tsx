import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

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
  const [results, setResults] = useState<ReadonlyArray<Product>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  const open = useCallback(() => setIsOpen(true), []);

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsOpen((previous) => !previous);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clear the query whenever the palette closes so it opens fresh next time.
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setIsSearching(false);
    }
  }, [isOpen]);

  // Debounced smart search against the local PGlite store.
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      window.offlineStore
        .searchProducts({ query: term, limit: 20 })
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const handleSelect = (product: Product) => {
    setIsOpen(false);
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  };

  const term = query.trim();
  const showEmpty = term.length > 0 && !isSearching && results.length === 0;

  return (
    <CommandMenuContext.Provider value={{ open }}>
      {children}
      <CommandMenuDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        query={query}
        onQueryChange={setQuery}
        results={results}
        isSearching={isSearching}
        showEmpty={showEmpty}
        onSelect={handleSelect}
      />
    </CommandMenuContext.Provider>
  );
}

// Split out so the dialog isn't part of the provider's own render identity.
function CommandMenuDialog({
  isOpen,
  onOpenChange,
  query,
  onQueryChange,
  results,
  isSearching,
  showEmpty,
  onSelect,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  results: ReadonlyArray<Product>;
  isSearching: boolean;
  showEmpty: boolean;
  onSelect: (product: Product) => void;
}) {
  return (
    <CommandDialog open={isOpen} onOpenChange={onOpenChange} title="Search products">
      {/* Server-side ranking already orders results, so disable cmdk filtering. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search products…"
          value={query}
          onValueChange={onQueryChange}
          autoFocus
        />
        <CommandList>
          {isSearching && results.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">Searching…</p>
          )}
          {showEmpty && (
            <p className="p-4 text-center text-xs text-muted-foreground">No products found.</p>
          )}
          {results.length > 0 && (
            <CommandGroup heading="Products">
              {results.map((product) => {
                const stock = productStock(product);
                return (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={() => onSelect(product)}
                  >
                    <span className="flex-1 truncate">
                      {product.name}
                      {product.strength && (
                        <span className="ml-1 text-muted-foreground">{product.strength}</span>
                      )}
                    </span>
                    <Badge variant={stock === 0 ? "outline" : "secondary"}>
                      {stock === 0 ? "Out of stock" : `${stock} in stock`}
                    </Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
