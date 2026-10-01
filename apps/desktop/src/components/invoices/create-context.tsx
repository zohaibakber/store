import type { BatchId, Product } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useRef, useState, type ReactNode, type RefObject } from "react";

import { toastManager } from "@/components/ui/toast";
import { useRememberRecentProduct } from "@/hooks/use-recent-products";
import { storeErrorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useInventoryActions } from "@/lib/inventory";

const AUTO_BATCH = "auto";

interface SaleLine {
  key: number;
  product: Product;
  batchId: BatchId | typeof AUTO_BATCH;
  quantity: number | null;
  quantityUnit: "unit" | "pack";
  salePrice: number | null;
}

interface InvoiceCreateState {
  customerName: string;
  lines: SaleLine[];
  bulkDiscount: number | null;
}

interface InvoiceCreateActions {
  addProduct: (product: Product, quantity?: number) => void;
  updateLine: (key: number, changes: Partial<SaleLine>) => void;
  setLineQuantityUnit: (key: number, quantityUnit: SaleLine["quantityUnit"]) => void;
  removeLine: (key: number) => void;
  setCustomerName: (value: string) => void;
  setBulkDiscount: (value: number | null) => void;
  completeSale: () => Promise<void>;
  focusSearch: () => void;
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
}

interface InvoiceCreateContextValue {
  state: InvoiceCreateState;
  actions: InvoiceCreateActions;
  meta: InvoiceCreateMeta;
}

const InvoiceCreateContext = createContext<InvoiceCreateContextValue | null>(null);

const suggestedPrice = (product: Product, quantityUnit: SaleLine["quantityUnit"]) =>
  quantityUnit === "pack" ? product.retailPrice : product.unitPrice;

const paisaToRupees = (paisa: number | null) => (paisa == null ? null : paisa / 100);

const availableStock = (line: SaleLine) => {
  const batches =
    line.batchId === AUTO_BATCH
      ? line.product.batches
      : line.product.batches.filter((batch) => batch.id === line.batchId);
  return line.quantityUnit === "pack"
    ? batches.reduce((sum, batch) => sum + batch.packQuantity, 0)
    : batches.reduce(
        (sum, batch) => sum + batch.packQuantity * line.product.unitsPerPack + batch.unitQuantity,
        0,
      );
};

const lineError = (line: SaleLine) => {
  const quantity = line.quantity;
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1) return "Enter a quantity";
  const available = availableStock(line);
  if (quantity > available) {
    return available === 0 ? "Out of stock" : `Only ${formatNumber(available)} in stock`;
  }
  if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0)
    return "Enter a price";
  return null;
};

const lineSalePrice = (line: SaleLine) => {
  if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0) return null;
  return Math.round(line.salePrice * 100);
};

const discountedSalePrice = (line: SaleLine, bulkDiscount: number) => {
  const price = lineSalePrice(line);
  return price == null ? null : Math.round(price * (1 - bulkDiscount / 100));
};

const lineTotal = (line: SaleLine, bulkDiscount = 0) => {
  const price = discountedSalePrice(line, bulkDiscount);
  if (
    line.quantity == null ||
    !Number.isInteger(line.quantity) ||
    line.quantity < 1 ||
    price == null
  )
    return null;
  return line.quantity * price;
};

const lineUnits = (line: SaleLine) =>
  (line.quantity ?? 0) * (line.quantityUnit === "pack" ? line.product.unitsPerPack : 1);

function InvoiceCreateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { issueInvoice } = useInventoryActions();
  const rememberRecentProduct = useRememberRecentProduct();
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [bulkDiscount, setBulkDiscount] = useState<number | null>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nextKeyRef = useRef(1);
  const searchRef = useRef<HTMLInputElement>(null);

  const addProduct = (product: Product, quantity = 1) => {
    const key = nextKeyRef.current++;
    rememberRecentProduct(product);
    setLines((current) => {
      const existing = current.find(
        (line) => line.product.id === product.id && line.batchId === AUTO_BATCH,
      );
      if (existing) {
        return current.map((line) =>
          line === existing ? { ...line, quantity: (line.quantity ?? 0) + quantity } : line,
        );
      }
      return [
        ...current,
        {
          key,
          product,
          batchId: AUTO_BATCH,
          quantity,
          quantityUnit: "unit",
          salePrice: paisaToRupees(suggestedPrice(product, "unit")),
        },
      ];
    });
  };

  const updateLine = (key: number, changes: Partial<SaleLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
  };

  const setLineQuantityUnit = (key: number, quantityUnit: SaleLine["quantityUnit"]) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? {
              ...line,
              quantityUnit,
              salePrice: paisaToRupees(suggestedPrice(line.product, quantityUnit)),
            }
          : line,
      ),
    );
  };

  const removeLine = (key: number) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  const errors = lines.map(lineError);
  const subtotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
  const unitCount = lines.reduce((sum, line) => sum + lineUnits(line), 0);
  const validBulkDiscount = bulkDiscount != null && bulkDiscount >= 0 && bulkDiscount <= 100;
  const total = validBulkDiscount
    ? lines.reduce((sum, line) => sum + (lineTotal(line, bulkDiscount) ?? 0), 0)
    : subtotal;
  const discountTotal = subtotal - total;
  const canSubmit =
    lines.length > 0 && errors.every((error) => error === null) && validBulkDiscount;

  const completeSale = async () => {
    if (submittingRef.current || !canSubmit || bulkDiscount == null) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    const discount = bulkDiscount;
    const items = [];
    for (const line of lines) {
      const quantity = line.quantity;
      const salePrice = discountedSalePrice(line, discount);
      if (quantity == null || salePrice == null) {
        submittingRef.current = false;
        setIsSubmitting(false);
        return;
      }
      items.push({
        productId: line.product.id,
        batchId: line.batchId === AUTO_BATCH ? null : line.batchId,
        quantity,
        quantityType: line.quantityUnit,
        salePrice,
      });
    }
    try {
      const invoice = await issueInvoice({
        customerName: customerName.trim() || null,
        items,
      });
      toastManager.add({
        title: `Invoice #${formatInvoiceNumber(invoice.invoiceNumber)} created`,
        type: "success",
      });
      setLines([]);
      setCustomerName("");
      setBulkDiscount(0);
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
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <InvoiceCreateContext
      value={{
        state: { customerName, lines, bulkDiscount },
        actions: {
          addProduct,
          updateLine,
          setLineQuantityUnit,
          removeLine,
          setCustomerName,
          setBulkDiscount,
          completeSale,
          focusSearch,
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

export {
  AUTO_BATCH,
  InvoiceCreateProvider,
  lineTotal,
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
};
