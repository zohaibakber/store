import type { Product } from "@store/contracts";
import type { ProductId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
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
  discountedSalePrice,
  draftTotal,
  enteredPrice,
  isValidDiscount,
  lineError,
  lineTotal,
  lineUnits,
  resolveSaleLine,
  saleTotal,
  type ProductLookup,
  type SaleLine,
  type SaleLineView,
} from "@/components/invoices/sale-line";
import { toastManager } from "@/components/ui/toast";
import { useRememberRecentProduct } from "@/hooks/use-recent-products";
import {
  useCompletingSaleIn,
  useSaleDraftsIn,
  useSaleDraftStoreIn,
  useSaleSearchFocusRequest,
} from "@/hooks/use-sale-drafts";
import { useWorkspaceStorageKey } from "@/hooks/use-workspace-storage-key";
import { storeErrorMessage } from "@/lib/errors";
import { useInventoryActions, useSuspenseCatalogProductsById } from "@/lib/inventory";
import {
  activateSaleDraft,
  activateSaleDraftAt,
  activeSaleDraft,
  addSaleProduct,
  AUTO_BATCH,
  canOpenSaleDraft,
  closeSaleDraft,
  cycleSaleDraft,
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
  readonly id: number;
  readonly label: string;
  readonly lineCount: number;
  readonly total: number;
}

interface InvoiceCreateState {
  draftId: number;
  customerName: string;
  lines: ReadonlyArray<SaleLineView>;
  bulkDiscount: number | null;
}

interface InvoiceCreateActions {
  addProduct: (product: Product, quantity?: number) => void;
  updateLine: (key: number, changes: SaleLineEdits) => void;
  setLineQuantityUnit: (key: number, quantityUnit: SaleLine["quantityUnit"]) => void;
  removeLine: (key: number) => void;
  setCustomerName: (value: string) => void;
  setBulkDiscount: (value: number | null) => void;
  completeSale: () => Promise<void>;
  focusSearch: () => void;
  openDraft: () => void;
  activateDraft: (id: number) => void;
  activateDraftAt: (index: number) => void;
  cycleDraft: (step: 1 | -1) => void;
  discardDraft: (id: number) => void;
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
}

interface InvoiceCreateContextValue {
  state: InvoiceCreateState;
  actions: InvoiceCreateActions;
  meta: InvoiceCreateMeta;
}

const InvoiceCreateContext = createContext<InvoiceCreateContextValue | null>(null);

type ProductSeeds = {
  readonly since: ReadonlyArray<ProductId>;
  readonly products: ReadonlyMap<string, Product>;
};

const NO_SEEDS: ProductSeeds = { since: [], products: new Map() };

const sameIds = (left: ReadonlyArray<ProductId>, right: ReadonlyArray<ProductId>) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

function useDraftProducts(drafts: SaleDrafts) {
  const ids = saleProductIds(drafts);
  const [requested, setRequested] = useState(ids);
  const changed = !sameIds(requested, ids);
  if (changed) setRequested(ids);
  const current = changed ? ids : requested;
  const settled = useDeferredValue(current);
  const products = useSuspenseCatalogProductsById(settled);
  const [seeds, setSeeds] = useState(NO_SEEDS);
  const live = new Map<string, Product>(products.map((product) => [product.id, product]));
  const seeded = seeds.since === settled ? seeds.products : NO_SEEDS.products;

  const lookup: ProductLookup = (productId) =>
    live.get(productId) ?? (settled === current ? undefined : (seeded.get(productId) ?? "loading"));

  const seed = (product: Product) => {
    if (live.has(product.id)) return;
    setSeeds((known) => ({
      since: settled,
      products: new Map(known.since === settled ? known.products : []).set(product.id, product),
    }));
  };

  return { lookup, seed };
}

function InvoiceCreateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { issueInvoice } = useInventoryActions();
  const rememberRecentProduct = useRememberRecentProduct();
  const workspace = useWorkspaceStorageKey();
  const drafts = useSaleDraftsIn(workspace);
  const store = useSaleDraftStoreIn(workspace);
  const { lookup, seed } = useDraftProducts(drafts);
  const draft = activeSaleDraft(drafts);
  const isSubmitting = useCompletingSaleIn(workspace, draft.id);
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

  const updateLine = (key: number, { salePrice, ...changes }: SaleLineEdits) => {
    const line = lines.find((candidate) => candidate.key === key);
    if (line?.kind !== "ready") return;
    store.update((state) =>
      updateSaleLine(
        state,
        key,
        salePrice === undefined
          ? changes
          : { ...changes, price: enteredPrice(line.product, line.quantityUnit, salePrice) },
      ),
    );
  };

  const setLineQuantityUnit = (key: number, quantityUnit: SaleLine["quantityUnit"]) =>
    store.update((state) => setSaleLineUnit(state, key, quantityUnit));

  const removeLine = (key: number) => store.update((state) => removeSaleLine(state, key));

  const setCustomerName = (value: string) =>
    store.update((state) => setSaleCustomer(state, draft.id, value));

  const setBulkDiscount = (value: number | null) =>
    store.update((state) => setSaleDiscount(state, draft.id, value));

  const activate = (change: (state: SaleDrafts) => SaleDrafts) => {
    store.update(change);
    store.focusSearch();
  };

  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  const errors = lines.map(lineError);
  const subtotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
  const unitCount = lines.reduce((sum, line) => sum + lineUnits(line), 0);
  const validBulkDiscount = isValidDiscount(bulkDiscount);
  const total = saleTotal(lines, bulkDiscount);
  const discountTotal = subtotal - total;
  const canSubmit =
    lines.length > 0 && errors.every((error) => error === null) && validBulkDiscount;

  const completeSale = async () => {
    if (!canSubmit || !isValidDiscount(bulkDiscount)) return;
    const items = [];
    for (const line of lines) {
      if (line.kind !== "ready") return;
      const quantity = line.quantity;
      const salePrice = discountedSalePrice(line, bulkDiscount);
      if (quantity == null || salePrice == null) return;
      items.push({
        productId: line.product.id,
        batchId: line.batchId === AUTO_BATCH ? null : line.batchId,
        quantity,
        quantityType: line.quantityUnit,
        salePrice,
      });
    }
    if (!store.beginCompleting(draft.id)) return;
    try {
      const invoice = await issueInvoice({
        customerName: customerName.trim() || null,
        items,
      });
      toastManager.add({
        title: `Invoice #${formatInvoiceNumber(invoice.invoiceNumber)} created`,
        type: "success",
      });
      store.update((state) => closeSaleDraft(state, draft.id));
      await navigate({
        to: "/invoices/$invoiceId",
        params: { invoiceId: invoice.invoiceId },
      });
    } catch (error) {
      toastManager.add({
        title: storeErrorMessage(error, "Could not create the invoice."),
        type: "error",
      });
    } finally {
      store.endCompleting(draft.id);
    }
  };

  const tabs = drafts.drafts.map((open) => ({
    id: open.id,
    label: saleDraftLabel(open),
    lineCount: open.lines.length,
    total: draftTotal(open, lookup),
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
          focusSearch,
          openDraft: store.open,
          activateDraft: (id) => activate((state) => activateSaleDraft(state, id)),
          activateDraftAt: (index) => activate((state) => activateSaleDraftAt(state, index)),
          cycleDraft: (step) => activate((state) => cycleSaleDraft(state, step)),
          discardDraft: store.discard,
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

export { InvoiceCreateProvider, useInvoiceCreate, type SaleDraftTab };
