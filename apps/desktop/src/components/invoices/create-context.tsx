import type { IssueInvoiceResult, Product } from "@store/contracts";
import type { InvoiceId, ProductId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import {
  useCommand,
  useSuspenseCatalogProductsById,
  type CommandExit,
} from "@store/inventory-react";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  use,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  draftTotal,
  enteredPrice,
  isValidDiscount,
  lineError,
  lineTotal,
  lineUnits,
  resolveSaleLine,
  saleItems,
  saleTotal,
  type ProductLookup,
  type SaleLine,
  type SaleLineView,
} from "@/components/invoices/sale-line";
import { usePrintReceipt } from "@/components/receipts/print-host";
import { toastManager } from "@/components/ui/toast";
import { useReceiptFormat } from "@/hooks/use-receipt-format";
import { useRememberRecentProduct } from "@/hooks/use-recent-products";
import {
  useCompletingSale,
  useDropIssuedSaleDrafts,
  useSaleDraftOwner,
  useSaleDraftsIn,
  useSaleDraftActions,
  useSaleSearchFocusRequest,
} from "@/hooks/use-sale-drafts";
import { toastFailure } from "@/lib/errors";
import {
  activateSaleDraft,
  activateSaleDraftAt,
  activeSaleDraft,
  addSaleProduct,
  canOpenSaleDraft,
  cycleSaleDraft,
  isBlankDraft,
  quantitiesInOtherDrafts,
  removeSaleLine,
  saleDraftLabel,
  saleProductIds,
  setSaleCustomer,
  setSaleDiscount,
  setSaleLineUnit,
  updateSaleLine,
  type SaleDrafts,
} from "@/lib/sale-drafts";

type SaleLineEdits = Partial<Pick<SaleLine, "batchId" | "quantity" | "salePrice">>;

interface SaleDraftTab {
  readonly id: InvoiceId;
  readonly label: string;
  readonly lineCount: number;
  readonly total: number;
}

interface InvoiceCreateState {
  draftId: InvoiceId;
  customerName: string;
  lines: ReadonlyArray<SaleLineView>;
  bulkDiscount: number | null;
}

interface InvoiceCreateActions {
  addProduct: (product: Product, quantity?: number) => void;
  updateLine: (line: SaleLine, changes: SaleLineEdits) => void;
  setLineQuantityUnit: (key: number, quantityUnit: SaleLine["quantityUnit"]) => void;
  removeLine: (key: number) => void;
  setCustomerName: (value: string) => void;
  setBulkDiscount: (value: number | null) => void;
  completeSale: () => void;
  focusSearch: () => void;
  openDraft: () => void;
  activateDraft: (id: InvoiceId) => void;
  activateDraftAt: (index: number) => void;
  cycleDraft: (step: 1 | -1) => void;
  discardDraft: (id: InvoiceId) => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

interface InvoiceCreateMeta {
  errors: Array<string | null>;
  subtotal: number;
  discountTotal: number;
  total: number;
  unitCount: number;
  validBulkDiscount: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  tabs: ReadonlyArray<SaleDraftTab>;
  canOpenDraft: boolean;
  discarding: SaleDraftTab | null;
}

interface InvoiceCreateContextValue {
  state: InvoiceCreateState;
  actions: InvoiceCreateActions;
  meta: InvoiceCreateMeta;
}

const InvoiceCreateContext = createContext<InvoiceCreateContextValue | null>(null);

type ProductSeeds = {
  readonly since: string;
  readonly products: ReadonlyMap<string, Product>;
};

const NO_SEEDS: ProductSeeds = { since: "", products: new Map() };

const ID_SEPARATOR = "\n";

const idsKey = (ids: ReadonlyArray<ProductId>) => ids.join(ID_SEPARATOR);

function useDraftProducts(drafts: SaleDrafts) {
  const ids = saleProductIds(drafts);
  const [requested, setRequested] = useState(ids);
  if (idsKey(requested) !== idsKey(ids)) setRequested(ids);
  const settled = useDeferredValue(requested);
  const settledKey = idsKey(settled);
  const products = useSuspenseCatalogProductsById(settled);
  const [seeds, setSeeds] = useState(NO_SEEDS);
  const live = new Map<string, Product>(products.map((product) => [product.id, product]));
  const seeded = seeds.since === settledKey ? seeds.products : NO_SEEDS.products;

  const lookup: ProductLookup = (productId) =>
    live.get(productId) ??
    (settled === requested ? undefined : (seeded.get(productId) ?? "loading"));

  const seed = (product: Product) => {
    if (live.has(product.id)) return;
    setSeeds((known) => ({
      since: settledKey,
      products: new Map(known.since === settledKey ? known.products : []).set(product.id, product),
    }));
  };

  return { lookup, seed };
}

const recordSale = async (sale: {
  readonly issue: () => Promise<CommandExit<IssueInvoiceResult>>;
  readonly close: () => boolean;
  readonly focusSearch: () => void;
  readonly view: (invoiceId: InvoiceId) => Promise<void>;
  readonly print: (invoiceId: InvoiceId) => void;
}) => {
  const exit = await sale.issue();
  if (exit._tag === "Failure") {
    toastFailure(exit.cause);
    return;
  }
  const invoice = exit.value;
  sale.print(invoice.invoiceId);
  const title = `Invoice #${formatInvoiceNumber(invoice.invoiceNumber)} created`;
  if (sale.close()) {
    const toastId = toastManager.add({
      actionProps: {
        children: "View",
        onClick: () => {
          toastManager.close(toastId);
          void sale.view(invoice.invoiceId);
        },
      },
      title,
      type: "success",
    });
    sale.focusSearch();
  } else {
    toastManager.add({ title, type: "success" });
    await sale.view(invoice.invoiceId);
  }
};

function InvoiceCreateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [issueInvoice] = useCommand((commands) => commands.issueInvoice);
  const rememberRecentProduct = useRememberRecentProduct();
  const printReceipt = usePrintReceipt();
  const receiptFormat = useReceiptFormat();
  const owner = useSaleDraftOwner();
  const drafts = useSaleDraftsIn(owner);
  const store = useSaleDraftActions(owner);
  const { lookup, seed } = useDraftProducts(drafts);
  const draft = activeSaleDraft(drafts);
  const isSubmitting = useCompletingSale(draft.id);
  useDropIssuedSaleDrafts(owner);
  const focusRequest = useSaleSearchFocusRequest();
  const searchRef = useRef<HTMLInputElement>(null);

  const { bulkDiscount, customerName } = draft;
  const elsewhere = quantitiesInOtherDrafts(drafts, draft.id);
  const lines = draft.lines.map((line) =>
    resolveSaleLine(line, lookup, elsewhere.get(line.productId)),
  );

  useEffect(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusRequest]);

  const addProduct = (product: Product, quantity = 1) => {
    rememberRecentProduct(product);
    seed(product);
    store.update((state) => addSaleProduct(state, draft.id, product.id, quantity));
  };

  const updateLine = (line: SaleLine, { salePrice, ...changes }: SaleLineEdits) =>
    store.update((state) =>
      updateSaleLine(
        state,
        line.key,
        salePrice === undefined
          ? changes
          : { ...changes, price: enteredPrice(line.product, line.quantityUnit, salePrice) },
      ),
    );

  const setLineQuantityUnit = (key: number, quantityUnit: SaleLine["quantityUnit"]) =>
    store.update((state) => setSaleLineUnit(state, key, quantityUnit));

  const removeLine = (key: number) => store.update((state) => removeSaleLine(state, key));

  const setCustomerName = (value: string) =>
    store.update((state) => setSaleCustomer(state, draft.id, value));

  const setBulkDiscount = (value: number | null) =>
    store.update((state) => setSaleDiscount(state, draft.id, value));

  const [discardingId, setDiscardingId] = useState<InvoiceId | null>(null);

  const discardDraft = (id: InvoiceId) => {
    const target = drafts.drafts.find((open) => open.id === id);
    if (target === undefined) return;
    if (isBlankDraft(target)) store.discard(id);
    else setDiscardingId(id);
  };

  const confirmDiscard = () => {
    if (discardingId !== null) store.discard(discardingId);
    setDiscardingId(null);
  };

  const cancelDiscard = () => {
    setDiscardingId(null);
    store.focusSearch();
  };

  const activate = (change: (state: SaleDrafts) => SaleDrafts) => {
    store.update(change);
    store.focusSearch();
  };

  const errors = lines.map(lineError);
  const subtotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
  const unitCount = lines.reduce((sum, line) => sum + lineUnits(line), 0);
  const validBulkDiscount = isValidDiscount(bulkDiscount);
  const total = saleTotal(lines, bulkDiscount);
  const discountTotal = subtotal - total;
  const canSubmit =
    lines.length > 0 && errors.every((error) => error === null) && validBulkDiscount;

  const completeSale = () => {
    const items = isValidDiscount(bulkDiscount) ? saleItems(lines, bulkDiscount) : null;
    if (items === null) return;
    store.complete(draft.id, (finish) =>
      recordSale({
        issue: () =>
          issueInvoice({
            input: { customerName: customerName.trim() || null, items },
            invoiceId: draft.id,
          }),
        close: finish.close,
        focusSearch: finish.focusSearch,
        view: (invoiceId) => navigate({ to: "/invoices/$invoiceId", params: { invoiceId } }),
        print: (invoiceId) => {
          if (receiptFormat.printAfterSale) {
            printReceipt({ invoiceId, paper: receiptFormat.paper, output: "printer" });
          }
        },
      }),
    );
  };

  const tabs = drafts.drafts.map((open) => ({
    id: open.id,
    label: saleDraftLabel(open),
    lineCount: open.lines.length,
    total: open.id === draft.id ? total : draftTotal(open, lookup),
  }));

  return (
    <InvoiceCreateContext
      value={{
        state: { draftId: draft.id, customerName, lines, bulkDiscount },
        actions: {
          addProduct,
          updateLine,
          setLineQuantityUnit,
          removeLine,
          setCustomerName,
          setBulkDiscount,
          completeSale,
          focusSearch: store.focusSearch,
          openDraft: store.open,
          activateDraft: (id) => activate((state) => activateSaleDraft(state, id)),
          activateDraftAt: (index) => activate((state) => activateSaleDraftAt(state, index)),
          cycleDraft: (step) => activate((state) => cycleSaleDraft(state, step)),
          discardDraft,
          confirmDiscard,
          cancelDiscard,
        },
        meta: {
          errors,
          subtotal,
          discountTotal,
          total,
          unitCount,
          validBulkDiscount,
          canSubmit,
          isSubmitting,
          searchRef,
          tabs,
          canOpenDraft: canOpenSaleDraft(drafts),
          discarding: tabs.find((tab) => tab.id === discardingId) ?? null,
        },
      }}
    >
      {children}
    </InvoiceCreateContext>
  );
}

function useInvoiceCreate() {
  const context = use(InvoiceCreateContext);
  if (!context) throw new Error("Invoice create components must be used within their provider.");
  return context;
}

export { InvoiceCreateProvider, useInvoiceCreate };
