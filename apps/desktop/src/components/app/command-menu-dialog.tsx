import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  CornerDownLeftIcon,
  PackageIcon,
  FileImportIcon,
  HomeIcon,
  Invoice01Icon,
  PackageAddIcon,
  PencilEdit02Icon,
  PlusSignCircleIcon,
  SettingsIcon,
  ShoppingBasket01Icon,
  ShoppingCartAdd01Icon,
  SunMoonIcon,
  TagIcon,
  TagsIcon,
  UserMultipleIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { Invoice, Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { useInventoryInvoices } from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import type { StockStatus } from "@store/services/insights";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Fragment,
  Suspense,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useTheme } from "@/components/theme/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  useRecentProducts,
  useRememberRecentProduct,
  type RecentProduct,
} from "@/hooks/use-recent-products";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { EMPTY, formatCount, formatDate } from "@/lib/format";
import {
  useCatalogIsReady,
  useProductInsight,
  useSuspenseCatalogProduct,
  useSuspenseProductSearch,
} from "@/lib/inventory";
import { cn } from "@/lib/utils";
import { Route as RootRoute } from "@/routes/__root";

const PRODUCT_LIMIT = 30;
const ALL_PRODUCT_LIMIT = 8;
const ALL_INVOICE_LIMIT = 5;
const INVOICE_LIMIT = 30;
const INVOICE_WINDOW = 200;
const SUGGESTED_ACTION_IDS = ["new-sale", "add-product", "go-products", "go-invoices"];

type Scope = "all" | "products" | "invoices" | "actions";

const SCOPES: ReadonlyArray<{ readonly value: Scope; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "products", label: "Products" },
  { value: "invoices", label: "Invoices" },
  { value: "actions", label: "Actions" },
];

const PLACEHOLDERS = {
  all: "Search products, invoices, and actions…",
  products: "Search products…",
  invoices: "Search invoices by number or customer…",
  actions: "Search actions…",
} satisfies Record<Scope, string>;

type ProductTarget = {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly category: { readonly name: string };
};

type ActionEntry = {
  readonly kind: "action";
  readonly id: string;
  readonly label: string;
  readonly keywords: string;
  readonly icon: IconSvgElement;
  readonly shortcut?: string;
  readonly run: () => void;
};

type Entry =
  | { readonly kind: "product"; readonly id: string; readonly product: Product }
  | { readonly kind: "recent"; readonly id: string; readonly recent: RecentProduct }
  | { readonly kind: "invoice"; readonly id: string; readonly invoice: Invoice }
  | ActionEntry;

type EntryGroup = { readonly value: string; readonly items: ReadonlyArray<Entry> };

type Page =
  | { readonly kind: "root" }
  | { readonly kind: "product"; readonly target: ProductTarget };

const ROOT_PAGE: Page = { kind: "root" };

const recentTarget = (recent: RecentProduct): ProductTarget => ({
  id: recent.id,
  name: recent.name,
  strength: recent.strength,
  category: { name: recent.categoryName },
});

const entryTarget = (entry: Entry | undefined): ProductTarget | undefined => {
  if (entry?.kind === "product") return entry.product;
  if (entry?.kind === "recent") return recentTarget(entry.recent);
  return undefined;
};

const productLabel = (target: ProductTarget) =>
  target.strength ? `${target.name} ${target.strength}` : target.name;

const tokensOf = (query: string) => query.toLowerCase().split(/\s+/u).filter(Boolean);

const matchesAction = (action: ActionEntry, tokens: ReadonlyArray<string>) => {
  const haystack = `${action.label} ${action.keywords}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
};

const matchInvoices = (invoices: ReadonlyArray<Invoice>, query: string, limit: number) => {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return invoices.slice(0, limit);
  const number = trimmed.replace(/^#/u, "");
  const numeric = /^\d+$/u.test(number);
  const matches = invoices.filter((invoice) =>
    numeric
      ? String(invoice.invoiceNumber).startsWith(number)
      : (invoice.customerName ?? "").toLowerCase().includes(trimmed),
  );
  return matches.slice(0, limit);
};

const isModified = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey;

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
      <CommandDialogPopup aria-label="Search" className="max-h-128 max-w-2xl">
        {!inventory ? (
          <p className="p-6 text-sm text-destructive">Search is unavailable.</p>
        ) : !scope ? (
          <p className="p-6 text-sm text-destructive">Search workspace is unavailable.</p>
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
  return <CommandPalette onOpenChange={onOpenChange} />;
}

function CommandPalette({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [page, setPage] = useState<Page>(ROOT_PAGE);
  const [rootQuery, setRootQuery] = useState("");
  const searchQuery = useDeferredValue(page.kind === "root" ? query : rootQuery);

  const openPage = (target: ProductTarget) => {
    setRootQuery(query);
    setPage({ kind: "product", target });
    setQuery("");
  };

  const closePage = () => {
    setPage(ROOT_PAGE);
    setQuery(rootQuery);
  };

  return (
    <PaletteResults
      closePage={closePage}
      onOpenChange={onOpenChange}
      onQueryChange={setQuery}
      onScopeChange={setScope}
      openPage={openPage}
      page={page}
      query={query}
      scope={scope}
      searchQuery={searchQuery}
    />
  );
}

function useActions(close: () => void): ReadonlyArray<ActionEntry> {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const newSaleLabel = appHost().newSaleShortcut.label;

  return useMemo(() => {
    const go = (to: "/" | "/restock" | "/products" | "/invoices" | "/settings") => () => {
      close();
      void navigate({ to });
    };
    return [
      {
        kind: "action",
        id: "new-sale",
        label: "New sale",
        keywords: "invoice sell checkout bill",
        icon: PlusSignCircleIcon,
        shortcut: newSaleLabel,
        run: () => {
          close();
          void navigate({ to: "/invoices/new" });
        },
      },
      {
        kind: "action",
        id: "add-product",
        label: "Add product",
        keywords: "new create product",
        icon: Add01Icon,
        run: () => {
          close();
          void navigate({ to: "/products/new" });
        },
      },
      {
        kind: "action",
        id: "import-products",
        label: "Import products",
        keywords: "upload file invoice purchase bulk",
        icon: FileImportIcon,
        run: () => {
          close();
          void navigate({ to: "/products/upload" });
        },
      },
      {
        kind: "action",
        id: "new-purchase-order",
        label: "New purchase order",
        keywords: "supplier buy restock order draft purchase",
        icon: ShoppingBasket01Icon,
        run: () => {
          close();
          void navigate({ to: "/purchases", search: { new: true } });
        },
      },
      {
        kind: "action",
        id: "go-home",
        label: "Go to Home",
        keywords: "dashboard overview",
        icon: HomeIcon,
        run: go("/"),
      },
      {
        kind: "action",
        id: "go-products",
        label: "Go to Products",
        keywords: "catalog inventory",
        icon: TagIcon,
        run: go("/products"),
      },
      {
        kind: "action",
        id: "go-categories",
        label: "Go to Categories",
        keywords: "category groups",
        icon: TagsIcon,
        run: () => {
          close();
          void navigate({ to: "/products/categories" });
        },
      },
      {
        kind: "action",
        id: "go-purchases",
        label: "Go to Purchases",
        keywords: "purchase orders supplier deliveries",
        icon: ShoppingBasket01Icon,
        run: () => {
          close();
          void navigate({ to: "/purchases" });
        },
      },
      {
        kind: "action",
        id: "go-suppliers",
        label: "Suppliers",
        keywords: "go to suppliers wholesaler distributor vendor",
        icon: UserMultipleIcon,
        run: () => {
          close();
          void navigate({ to: "/purchases/suppliers" });
        },
      },
      {
        kind: "action",
        id: "go-restock",
        label: "Go to Restock",
        keywords: "reorder order low stock",
        icon: PackageIcon,
        run: go("/restock"),
      },
      {
        kind: "action",
        id: "go-invoices",
        label: "Go to Invoices",
        keywords: "sales history receipts",
        icon: Invoice01Icon,
        run: go("/invoices"),
      },
      {
        kind: "action",
        id: "go-settings",
        label: "Go to Settings",
        keywords: "preferences account organization",
        icon: SettingsIcon,
        run: go("/settings"),
      },
      {
        kind: "action",
        id: "toggle-theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        keywords: "toggle theme appearance dark light mode",
        icon: SunMoonIcon,
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
    ] satisfies ReadonlyArray<ActionEntry>;
  }, [close, navigate, newSaleLabel, setTheme, theme]);
}

function useProductActions(close: () => void) {
  const navigate = useNavigate();
  const rememberRecentProduct = useRememberRecentProduct();
  return useMemo(() => {
    const open = (target: ProductTarget) => {
      rememberRecentProduct(target);
      close();
      void navigate({ to: "/products/$productId", params: { productId: target.id } });
    };
    const addToSale = (target: ProductTarget) => {
      rememberRecentProduct(target);
      close();
      void navigate({ to: "/invoices/new", search: { add: target.id } });
    };
    const addStock = (target: ProductTarget) => {
      rememberRecentProduct(target);
      close();
      void navigate({
        to: "/products/$productId",
        params: { productId: target.id },
        search: { addStock: true },
      });
    };
    const edit = (target: ProductTarget) => {
      rememberRecentProduct(target);
      close();
      void navigate({ to: "/products/$productId/edit", params: { productId: target.id } });
    };
    return { open, addToSale, addStock, edit };
  }, [close, navigate, rememberRecentProduct]);
}

function PaletteResults({
  closePage,
  onOpenChange,
  onQueryChange,
  onScopeChange,
  openPage,
  page,
  query,
  scope,
  searchQuery,
}: {
  readonly closePage: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onScopeChange: (scope: Scope) => void;
  readonly openPage: (target: ProductTarget) => void;
  readonly page: Page;
  readonly query: string;
  readonly scope: Scope;
  readonly searchQuery: string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [highlighted, setHighlighted] = useState<Entry | undefined>(undefined);
  const close = useMemo(() => () => onOpenChange(false), [onOpenChange]);
  const actions = useActions(close);
  const productActions = useProductActions(close);
  const recents = useRecentProducts();
  const trimmed = searchQuery.trim();
  const products = useSuspenseProductSearch(trimmed, PRODUCT_LIMIT);
  const invoices = useInventoryInvoices(INVOICE_WINDOW).data;

  const highlight = (entry: Entry | undefined) => {
    setHighlighted(entry);
    const target = entryTarget(entry);
    if (target) {
      void router.preloadRoute({ to: "/products/$productId", params: { productId: target.id } });
    } else if (entry?.kind === "invoice") {
      void router.preloadRoute({
        to: "/invoices/$invoiceId",
        params: { invoiceId: entry.invoice.id },
      });
    }
  };

  const openInvoice = (invoice: Invoice) => {
    close();
    void navigate({ to: "/invoices/$invoiceId", params: { invoiceId: invoice.id } });
  };

  const groups = useMemo((): ReadonlyArray<EntryGroup> => {
    if (page.kind === "product") {
      const target = page.target;
      const pageActions: ReadonlyArray<ActionEntry> = [
        {
          kind: "action",
          id: "product-open",
          label: "Open product",
          keywords: "view details",
          icon: ViewIcon,
          shortcut: "Enter",
          run: () => productActions.open(target),
        },
        {
          kind: "action",
          id: "product-add-to-sale",
          label: "Add to sale",
          keywords: "sell invoice cart",
          icon: ShoppingCartAdd01Icon,
          shortcut: "Ctrl+Enter",
          run: () => productActions.addToSale(target),
        },
        {
          kind: "action",
          id: "product-add-stock",
          label: "Add stock",
          keywords: "batch receive restock",
          icon: PackageAddIcon,
          run: () => productActions.addStock(target),
        },
        {
          kind: "action",
          id: "product-edit",
          label: "Edit product",
          keywords: "change update price",
          icon: PencilEdit02Icon,
          run: () => productActions.edit(target),
        },
      ];
      const tokens = tokensOf(query);
      return [
        {
          value: "Actions",
          items: pageActions.filter((action) => matchesAction(action, tokens)),
        },
      ];
    }

    const tokens = tokensOf(trimmed);
    const productEntries = (limit: number): ReadonlyArray<Entry> =>
      products.slice(0, limit).map((product) => ({ kind: "product", id: product.id, product }));
    const recentEntries: ReadonlyArray<Entry> = recents.map((recent) => ({
      kind: "recent",
      id: recent.id,
      recent,
    }));
    const invoiceEntries = (limit: number): ReadonlyArray<Entry> =>
      matchInvoices(invoices, trimmed, limit).map((invoice) => ({
        kind: "invoice",
        id: invoice.id,
        invoice,
      }));
    const actionEntries = actions.filter((action) => matchesAction(action, tokens));

    const all: ReadonlyArray<EntryGroup> =
      scope === "all"
        ? trimmed === ""
          ? [
              { value: "Recent", items: recentEntries },
              {
                value: "Suggested",
                items: actions.filter((action) => SUGGESTED_ACTION_IDS.includes(action.id)),
              },
            ]
          : [
              { value: "Products", items: productEntries(ALL_PRODUCT_LIMIT) },
              { value: "Invoices", items: invoiceEntries(ALL_INVOICE_LIMIT) },
              { value: "Actions", items: actionEntries },
            ]
        : scope === "products"
          ? trimmed === ""
            ? [
                { value: "Recent", items: recentEntries },
                {
                  value: "Products",
                  items: productEntries(PRODUCT_LIMIT).filter(
                    (entry) => !recents.some((recent) => recent.id === entry.id),
                  ),
                },
              ]
            : [{ value: "Products", items: productEntries(PRODUCT_LIMIT) }]
          : scope === "invoices"
            ? [
                {
                  value: trimmed === "" ? "Latest invoices" : "Invoices",
                  items: invoiceEntries(INVOICE_LIMIT),
                },
              ]
            : [{ value: "Actions", items: actionEntries }];
    return all.filter((group) => group.items.length > 0);
  }, [actions, invoices, page, productActions, products, query, recents, scope, trimmed]);

  const runEntry = (entry: Entry) => {
    switch (entry.kind) {
      case "product":
        return productActions.open(entry.product);
      case "recent":
        return productActions.open(recentTarget(entry.recent));
      case "invoice":
        return openInvoice(entry.invoice);
      case "action":
        return entry.run();
    }
  };

  const highlightedTarget = page.kind === "product" ? page.target : entryTarget(highlighted);

  const cycleScope = (step: number) => {
    const index = SCOPES.findIndex((entry) => entry.value === scope);
    const next = SCOPES[(index + step + SCOPES.length) % SCOPES.length];
    if (next) onScopeChange(next.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (event.key === "Tab" && !isModified(event)) {
      event.preventDefault();
      if (page.kind === "root") cycleScope(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape" && !isModified(event) && !event.shiftKey) {
      if (page.kind === "product") {
        event.preventDefault();
        event.stopPropagation();
        closePage();
        return;
      }
      if (query !== "") {
        event.preventDefault();
        event.stopPropagation();
        onQueryChange("");
      }
      return;
    }
    if (event.key === "Backspace" && page.kind === "product" && input.value === "") {
      event.preventDefault();
      closePage();
      return;
    }
    if (!highlightedTarget) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
      event.preventDefault();
      productActions.addToSale(highlightedTarget);
      return;
    }
    if (page.kind !== "root") return;
    const caretAtEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const opensActions =
      (event.key === "Enter" && (event.altKey || event.shiftKey)) ||
      (event.key === "." && (event.ctrlKey || event.metaKey)) ||
      (event.key === "ArrowRight" && !isModified(event) && !event.shiftKey && caretAtEnd);
    if (opensActions) {
      event.preventDefault();
      openPage(highlightedTarget);
    }
  };

  const emptyMessage =
    page.kind === "product"
      ? "No matching actions."
      : trimmed === ""
        ? scope === "invoices"
          ? "No invoices yet."
          : "Type to search products."
        : scope === "invoices"
          ? "No invoices found."
          : scope === "actions"
            ? "No actions found."
            : "No results found.";

  return (
    <Command
      key={page.kind === "product" ? `product-${page.target.id}` : "root"}
      autoHighlight="always"
      filter={null}
      inline
      items={groups}
      itemToStringValue={(item: Entry) => item.id}
      keepHighlight
      onItemHighlighted={highlight}
      onValueChange={onQueryChange}
      open
      value={query}
    >
      <CommandInput
        aria-keyshortcuts="Tab Shift+Tab Control+Enter Control+Period"
        onKeyDown={onKeyDown}
        placeholder={page.kind === "product" ? "Search actions…" : PLACEHOLDERS[scope]}
        ref={inputRef}
      />
      {page.kind === "product" ? (
        <div className="flex h-9 items-center gap-2 px-4 text-sm">
          <Button
            aria-label="Back to results"
            onClick={() => {
              closePage();
              inputRef.current?.focus();
            }}
            onMouseDown={(event) => event.preventDefault()}
            size="icon-xs"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
          </Button>
          <Badge variant="outline">
            <span className="max-w-80 truncate capitalize">{productLabel(page.target)}</span>
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {page.target.category.name}
          </span>
        </div>
      ) : (
        <Tabs
          onValueChange={(value) => {
            const next = SCOPES.find((entry) => entry.value === value);
            if (next) onScopeChange(next.value);
            inputRef.current?.focus();
          }}
          value={scope}
        >
          <div className="px-3">
            <TabsList aria-label="Search scope" variant="underline">
              {SCOPES.map((entry) => (
                <TabsTab
                  key={entry.value}
                  onMouseDown={(event) => event.preventDefault()}
                  tabIndex={-1}
                  value={entry.value}
                >
                  {entry.label}
                </TabsTab>
              ))}
            </TabsList>
          </div>
        </Tabs>
      )}
      <CommandPanel>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandList>
          {(group: EntryGroup) => (
            <Fragment key={group.value}>
              <CommandGroup items={[...group.items]}>
                <CommandGroupLabel>{group.value}</CommandGroupLabel>
                <CommandCollection>
                  {(entry: Entry) => (
                    <CommandItem key={entry.id} onClick={() => runEntry(entry)} value={entry}>
                      <EntryRow entry={entry} />
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            </Fragment>
          )}
        </CommandList>
      </CommandPanel>
      <CommandFooter>
        <FooterHints
          entry={highlighted}
          onOpenActions={() => {
            if (highlightedTarget) openPage(highlightedTarget);
            inputRef.current?.focus();
          }}
          page={page}
        />
        <div className="flex items-center gap-4">
          {page.kind === "root" ? <Hint keys={<Kbd>Tab</Kbd>} label="Scope" /> : null}
          <Hint keys={<Kbd>Esc</Kbd>} label={page.kind === "product" ? "Back" : "Close"} />
        </div>
      </CommandFooter>
    </Command>
  );
}

function Hint({ keys, label }: { readonly keys: ReactNode; readonly label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {keys}
      <span>{label}</span>
    </span>
  );
}

const enterKey = (
  <Kbd>
    <HugeiconsIcon aria-hidden="true" icon={CornerDownLeftIcon} />
  </Kbd>
);

function FooterHints({
  entry,
  onOpenActions,
  page,
}: {
  readonly entry: Entry | undefined;
  readonly onOpenActions: () => void;
  readonly page: Page;
}) {
  if (!entry && page.kind === "root") return <span />;

  const navigate = (
    <Hint
      keys={
        <KbdGroup>
          <Kbd>
            <HugeiconsIcon aria-hidden="true" icon={ArrowUp01Icon} />
          </Kbd>
          <Kbd>
            <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
          </Kbd>
        </KbdGroup>
      }
      label="Navigate"
    />
  );

  if (page.kind === "product") {
    return (
      <div className="flex items-center gap-4">
        {navigate}
        <Hint keys={enterKey} label="Run" />
      </div>
    );
  }

  if (entry?.kind === "product" || entry?.kind === "recent") {
    return (
      <div className="flex items-center gap-4">
        <Hint keys={enterKey} label="Open" />
        <Hint
          keys={
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              {enterKey}
            </KbdGroup>
          }
          label="Add to sale"
        />
        <Button
          onClick={onOpenActions}
          onMouseDown={(event) => event.preventDefault()}
          size="xs"
          variant="ghost"
        >
          <Hint
            keys={
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>.</Kbd>
              </KbdGroup>
            }
            label="Actions"
          />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {navigate}
      <Hint
        keys={enterKey}
        label={
          entry?.kind === "invoice" ? "Open invoice" : entry?.kind === "action" ? "Run" : "Open"
        }
      />
    </div>
  );
}

function EntryRow({ entry }: { readonly entry: Entry }) {
  switch (entry.kind) {
    case "product":
      return <ProductRow product={entry.product} />;
    case "recent":
      return (
        <Suspense fallback={<RecentSnapshotRow recent={entry.recent} />}>
          <LiveRecentRow recent={entry.recent} />
        </Suspense>
      );
    case "invoice":
      return <InvoiceRow invoice={entry.invoice} />;
    case "action":
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            icon={entry.icon}
          />
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {entry.shortcut ? <CommandShortcut>{entry.shortcut}</CommandShortcut> : null}
        </span>
      );
  }
}

function ProductName({
  name,
  strength,
  categoryName,
}: {
  readonly name: string;
  readonly strength: string | null;
  readonly categoryName: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 truncate capitalize">
        {name}
        {strength ? <span className="text-muted-foreground"> {strength}</span> : null}
      </span>
      <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
        {categoryName}
      </span>
    </span>
  );
}

function LiveRecentRow({ recent }: { readonly recent: RecentProduct }) {
  const product = useSuspenseCatalogProduct(recent.id);
  return product ? <ProductRow product={product} /> : <RecentSnapshotRow recent={recent} />;
}

function RecentSnapshotRow({ recent }: { readonly recent: RecentProduct }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <ProductName
        categoryName={recent.categoryName}
        name={recent.name}
        strength={recent.strength}
      />
    </span>
  );
}

function ProductRow({ product }: { readonly product: Product }) {
  const stock = productStock(product);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <ProductName
        categoryName={product.category.name}
        name={product.name}
        strength={product.strength}
      />
      <Suspense fallback={<StockLabel status={null} stock={stock} />}>
        <LiveStockLabel productId={product.id} stock={stock} />
      </Suspense>
      <span className="w-20 shrink-0 text-right tabular-nums">
        {product.unitPrice === null ? EMPTY : formatPrice(product.unitPrice)}
      </span>
    </span>
  );
}

function LiveStockLabel({
  productId,
  stock,
}: {
  readonly productId: string;
  readonly stock: number;
}) {
  const insight = useProductInsight(productId);
  return <StockLabel status={insight?.status ?? null} stock={stock} />;
}

type StockTone = { readonly label: string; readonly className: string };

const STATUS_TONE = {
  out: { label: "Out of stock", className: "text-destructive-foreground" },
  critical: { label: "Running out", className: "text-destructive-foreground" },
  low: { label: "Reorder", className: "text-warning-foreground" },
} satisfies Partial<Record<StockStatus, StockTone>>;

const stockTone = (status: StockStatus | null, stock: number): StockTone | undefined => {
  if (stock <= 0 || status === "out") return STATUS_TONE.out;
  if (status === "critical") return STATUS_TONE.critical;
  if (status === "low") return STATUS_TONE.low;
  return undefined;
};

function StockLabel({
  status,
  stock,
}: {
  readonly status: StockStatus | null;
  readonly stock: number;
}) {
  const tone = stockTone(status, stock);
  return (
    <span
      className={cn(
        "flex w-28 shrink-0 items-center justify-end gap-1.5 text-xs tabular-nums",
        tone ? tone.className : "text-muted-foreground",
      )}
      title={tone?.label}
    >
      {tone && stock > 0 ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {stock <= 0 ? "Out of stock" : formatCount(stock, "unit")}
      {tone && stock > 0 ? <span className="sr-only">, {tone.label}</span> : null}
    </span>
  );
}

function InvoiceRow({ invoice }: { readonly invoice: Invoice }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 tabular-nums">#{invoice.invoiceNumber}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {invoice.customerName || EMPTY}
        </span>
      </span>
      <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatDate(invoice.createdAt)}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums">{formatPrice(invoice.total)}</span>
    </span>
  );
}
