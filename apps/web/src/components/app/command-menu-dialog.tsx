import {
  Add01Icon,
  ArrowLeft01Icon,
  PackageIcon,
  FileImportIcon,
  GlobalSearchIcon,
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
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import type { GlobalProduct } from "@store/contracts/server-api.schema";
import { useCatalogIsReady, useInventoryInvoices, useProductSearch } from "@store/inventory-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Activity,
  Fragment,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
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
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FrameFooter, FramePanel } from "@/components/ui/frame";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { canSearchGlobally, useGlobalProductSearch } from "@/hooks/use-global-product-search";
import { useStartSale } from "@/hooks/use-new-sale-shortcut";
import { useRecentProducts, useRememberRecentProduct } from "@/hooks/use-recent-products";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { toastStoreError } from "@/lib/errors";
import { isSubmitChord } from "@/lib/shortcuts";
import { Route as RootRoute } from "@/routes/__root";

import {
  emptyMessage,
  entryTarget,
  globalProductPrefill,
  INVOICE_WINDOW,
  pageGroups,
  PLACEHOLDERS,
  PRODUCT_LIMIT,
  productLabel,
  recentTarget,
  ROOT_PAGE,
  rootGroups,
  SCOPES,
  searchesInvoices,
  WEB_SEARCH_ACTION_ID,
  webSearchLabel,
  type ActionEntry,
  type Entry,
  type EntryGroup,
  type Page,
  type ProductTarget,
  type Scope,
} from "./command-menu-entries";
import { EntryRow, FooterHints, Hint } from "./command-menu-rows";

const isModified = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey;

const isGlobalToggleChord = (event: KeyboardEvent) =>
  (event.key === "g" || event.key === "G") &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;

export function InventoryCommandDialog({
  onOpenChange,
  open,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const auth = useAuth();
  const { access, inventory } = RootRoute.useRouteContext();
  const scope = access.inventoryScope(auth.snapshot);
  const [session, setSession] = useState(0);
  const [presented, setPresented] = useState(open);
  if (open && !presented) setPresented(true);

  return (
    <CommandDialog
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nowOpen) => {
        if (nowOpen) return;
        setPresented(false);
        setSession((current) => current + 1);
      }}
      open={open}
    >
      <CommandDialogPopup
        aria-label="Search"
        className="max-h-128 max-w-2xl"
        portalProps={{ keepMounted: true }}
      >
        <Activity mode={presented ? "visible" : "hidden"}>
          {!inventory ? (
            <p className="p-6 text-sm text-destructive">Search is unavailable.</p>
          ) : !scope ? (
            <p className="p-6 text-sm text-destructive">Search workspace is unavailable.</p>
          ) : (
            <LiveCommandMenu key={session} onOpenChange={onOpenChange} />
          )}
        </Activity>
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
  const startSale = useStartSale();

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
          startSale();
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
          void navigate({ to: "/categories" });
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
          void navigate({ to: "/suppliers" });
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
  }, [close, navigate, newSaleLabel, setTheme, startSale, theme]);
}

type ProductActions = Readonly<
  Record<"open" | "addToSale" | "addStock" | "edit", (target: ProductTarget) => void>
>;

const productPageActions = (
  target: ProductTarget,
  productActions: ProductActions,
): ReadonlyArray<ActionEntry> => [
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

function useProductActions(close: () => void): ProductActions {
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
  const products = useProductSearch(trimmed, PRODUCT_LIMIT);
  const { data: invoices, isReady: invoicesReady } = useInventoryInvoices(INVOICE_WINDOW);
  const awaitingInvoices = searchesInvoices(page, scope, trimmed) && !invoicesReady;
  const { view: globalView, search: searchWeb } = useGlobalProductSearch(trimmed);
  const searchesWeb = canSearchGlobally(globalView);

  const webSearch = useMemo(
    (): ActionEntry | null =>
      searchesWeb
        ? {
            kind: "action",
            id: WEB_SEARCH_ACTION_ID,
            label: webSearchLabel(trimmed),
            keywords: "",
            icon: GlobalSearchIcon,
            run: () => {
              onScopeChange("global");
              searchWeb();
            },
          }
        : null,
    [onScopeChange, searchWeb, searchesWeb, trimmed],
  );

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

  const addToCatalog = (product: GlobalProduct) => {
    close();
    void navigate({ to: "/products/new", search: globalProductPrefill(product) });
  };

  const openSource = (product: GlobalProduct) => {
    appHost()
      .openExternal(product.sourceUrl)
      .catch((cause: unknown) => toastStoreError(cause, "Could not open the source page."));
  };

  const groups = useMemo(
    (): ReadonlyArray<EntryGroup> =>
      page.kind === "product"
        ? pageGroups(productPageActions(page.target, productActions), query)
        : rootGroups({
            scope,
            trimmed,
            products,
            recents,
            invoices,
            actions,
            global: globalView,
            webSearch,
          }),
    [
      actions,
      globalView,
      invoices,
      page,
      productActions,
      products,
      query,
      recents,
      scope,
      trimmed,
      webSearch,
    ],
  );

  const [settledGroups, setSettledGroups] = useState(groups);
  if (!awaitingInvoices && settledGroups !== groups) setSettledGroups(groups);

  const shownGroups = useDeferredValue(settledGroups);

  const runEntry = (entry: Entry) => {
    switch (entry.kind) {
      case "product":
        return productActions.open(entry.product);
      case "recent":
        return productActions.open(recentTarget(entry.recent));
      case "invoice":
        return openInvoice(entry.invoice);
      case "global":
        return addToCatalog(entry.product);
      case "action":
        return entry.run();
    }
  };

  const highlightedTarget = page.kind === "product" ? page.target : entryTarget(highlighted);
  const inGlobalScope = page.kind === "root" && scope === "global";
  const highlightedGlobal =
    inGlobalScope &&
    highlighted?.kind === "global" &&
    shownGroups.some((group) => group.items.some((entry) => entry.id === highlighted.id))
      ? highlighted.product
      : undefined;

  const cycleScope = (step: number) => {
    const index = SCOPES.findIndex((entry) => entry.value === scope);
    const next = index === -1 ? SCOPES[0] : SCOPES[(index + step + SCOPES.length) % SCOPES.length];
    if (next) onScopeChange(next.value);
  };

  const toggleGlobal = () => onScopeChange(scope === "global" ? "all" : "global");

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (event.key === "Tab" && !isModified(event)) {
      event.preventDefault();
      if (page.kind === "root") cycleScope(event.shiftKey ? -1 : 1);
      return;
    }
    if (isGlobalToggleChord(event)) {
      event.preventDefault();
      if (page.kind === "root") toggleGlobal();
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
    if (highlightedGlobal && isSubmitChord(event)) {
      event.preventDefault();
      openSource(highlightedGlobal);
      return;
    }
    if (!highlightedTarget) return;
    if (isSubmitChord(event)) {
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

  return (
    <Command
      key={page.kind === "product" ? `product-${page.target.id}` : "root"}
      autoHighlight="always"
      filter={null}
      inline
      items={shownGroups}
      itemToStringValue={(item: Entry) => item.id}
      keepHighlight
      onItemHighlighted={highlight}
      onValueChange={onQueryChange}
      open
      value={query}
    >
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <CommandInput
            aria-keyshortcuts="Tab Shift+Tab Control+Enter Control+Period Control+G"
            onKeyDown={onKeyDown}
            placeholder={page.kind === "product" ? "Search actions…" : PLACEHOLDERS[scope]}
            ref={inputRef}
          />
        </div>
        {page.kind === "root" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label="Search the web"
                  className="me-4 shrink-0"
                  onMouseDown={(event) => event.preventDefault()}
                  onPressedChange={() => {
                    toggleGlobal();
                    inputRef.current?.focus();
                  }}
                  pressed={scope === "global"}
                  size="sm"
                  tabIndex={-1}
                />
              }
            >
              <HugeiconsIcon aria-hidden="true" icon={GlobalSearchIcon} />
            </TooltipTrigger>
            <TooltipPopup>
              <span className="flex items-center gap-2">
                Search the web
                <KbdGroup>
                  <Kbd>Ctrl</Kbd>
                  <Kbd>G</Kbd>
                </KbdGroup>
              </span>
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col px-1">
        <FramePanel className="flex min-h-0 flex-col overflow-hidden">
          <div className="-m-5 flex min-h-0 flex-col">
            {page.kind === "product" ? (
              <div className="flex h-9 shrink-0 items-center gap-2 px-4 pt-1 text-sm">
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
                  <span className="max-w-80 truncate">{productLabel(page.target)}</span>
                </Badge>
                <span className="truncate text-xs text-muted-foreground">
                  {page.target.category.name}
                </span>
              </div>
            ) : (
              <div
                aria-label="Search scope"
                className="flex shrink-0 items-center gap-1.5 px-3 pt-3"
                role="group"
              >
                {SCOPES.map((entry) => (
                  <Button
                    aria-pressed={entry.value === scope}
                    key={entry.value}
                    onClick={() => {
                      onScopeChange(entry.value);
                      inputRef.current?.focus();
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    size="sm"
                    tabIndex={-1}
                    variant={entry.value === scope ? "secondary" : "ghost"}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>
            )}
            {inGlobalScope && globalView._tag === "Searching" ? (
              <div
                aria-live="polite"
                className="flex h-40 shrink-0 flex-col items-center justify-center gap-2.5 px-4 text-sm text-muted-foreground"
              >
                <Spinner className="size-4 shrink-0" />
                <span>Searching the web…</span>
              </div>
            ) : null}
            {inGlobalScope && globalView._tag === "Ready" && globalView.failure !== null ? (
              <p
                className="shrink-0 px-4 pt-3 text-center text-sm text-muted-foreground"
                role="alert"
              >
                {globalView.failure}
              </p>
            ) : null}
            {shownGroups === groups ? (
              <CommandEmpty>{emptyMessage(page, scope, trimmed, globalView)}</CommandEmpty>
            ) : null}
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
          </div>
        </FramePanel>
      </div>
      <FrameFooter>
        <div className="-my-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
        </div>
      </FrameFooter>
    </Command>
  );
}
