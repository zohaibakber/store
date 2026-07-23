import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  HomeIcon,
  Invoice01Icon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";

type CommandRoute =
  | "/"
  | "/products"
  | "/invoices"
  | "/settings"
  | "/products/new"
  | "/products/upload"
  | "/invoices/new";

const linkItems: ReadonlyArray<{ label: string; url: CommandRoute; icon: React.ReactNode }> = [
  { label: "Home", url: "/", icon: <HugeiconsIcon icon={HomeIcon} /> },
  { label: "Products", url: "/products", icon: <HugeiconsIcon icon={TagIcon} /> },
  { label: "Invoices", url: "/invoices", icon: <HugeiconsIcon icon={Invoice01Icon} /> },
  { label: "Settings", url: "/settings", icon: <HugeiconsIcon icon={SettingsIcon} /> },
];

const actionItems: ReadonlyArray<{ label: string; url: CommandRoute; icon: React.ReactNode }> = [
  { label: "New product", url: "/products/new", icon: <HugeiconsIcon icon={Add01Icon} /> },
  {
    label: "Import products",
    url: "/products/upload",
    icon: <HugeiconsIcon icon={Upload01Icon} />,
  },
  { label: "New invoice", url: "/invoices/new", icon: <HugeiconsIcon icon={Add01Icon} /> },
];

interface CommandMenuContextValue {
  readonly open: () => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function useCommandMenu(): CommandMenuContextValue {
  const context = useContext(CommandMenuContext);
  if (!context) throw new Error("useCommandMenu must be used within a CommandMenuProvider");
  return context;
}

type CommandPage = "home" | "products";

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState<CommandPage>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<Product>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  const open = useCallback(() => setIsOpen(true), []);

  // Slash opens the palette unless the user is already typing in an editable control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("select") ||
          (target.matches("input, textarea") && !target.hasAttribute("readonly")));

      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isEditable) return;

      event.preventDefault();
      setIsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Back to the home page with a clean query whenever the palette closes.
  useEffect(() => {
    if (!isOpen) {
      setPage("home");
      setQuery("");
      setResults([]);
      setIsSearching(false);
    }
  }, [isOpen]);

  // Debounced smart search against the local PGlite store, active on the products page.
  useEffect(() => {
    if (page !== "products") return;
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
  }, [page, query]);

  const handleNavigate = (url: CommandRoute) => {
    setIsOpen(false);
    void navigate({ to: url });
  };

  const handleSelectProduct = (product: Product) => {
    setIsOpen(false);
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  };

  // Selecting "Search products" pushes into a dedicated page, carrying over
  // whatever was already typed on the home page — mirrors cmdk's nested-page pattern.
  const enterProductsPage = () => setPage("products");

  const exitProductsPage = () => {
    setPage("home");
    setQuery("");
    setResults([]);
    setIsSearching(false);
  };

  const term = query.trim();
  const showEmpty = term.length > 0 && !isSearching && results.length === 0;

  return (
    <CommandMenuContext.Provider value={{ open }}>
      {children}
      <CommandDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Command menu"
        description="Jump to a page, run an action, or search products."
      >
        <Command
          shouldFilter={page === "home"}
          onKeyDown={(event) => {
            const atHomeInput = page === "home";
            if (
              !atHomeInput &&
              (event.key === "Escape" || (event.key === "Backspace" && query.length === 0))
            ) {
              event.preventDefault();
              exitProductsPage();
            }
          }}
        >
          <CommandInput
            placeholder={page === "products" ? "Search products…" : "Search or jump to…"}
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            {page === "home" && (
              <>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Links">
                  {linkItems.map((item) => (
                    <CommandItem
                      key={item.url}
                      value={item.label}
                      onSelect={() => handleNavigate(item.url)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  {actionItems.map((item) => (
                    <CommandItem
                      key={item.url}
                      value={item.label}
                      onSelect={() => handleNavigate(item.url)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </CommandItem>
                  ))}
                  <CommandItem
                    value="search-products"
                    keywords={term ? [term] : undefined}
                    onSelect={enterProductsPage}
                  >
                    <HugeiconsIcon icon={SearchIcon} />
                    <span>{term ? `Search products for "${term}"` : "Search products"}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
            {page === "products" && (
              <>
                {isSearching && results.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">Searching…</p>
                )}
                {showEmpty && <CommandEmpty>No products found.</CommandEmpty>}
                {results.length > 0 && (
                  <CommandGroup heading="Products">
                    {results.map((product) => {
                      const stock = productStock(product);
                      return (
                        <CommandItem
                          key={product.id}
                          value={product.id}
                          onSelect={() => handleSelectProduct(product)}
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
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </CommandMenuContext.Provider>
  );
}
