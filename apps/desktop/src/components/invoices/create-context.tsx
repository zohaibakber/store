import type { Product } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useState, type ReactNode } from "react";

import { toastManager } from "@/components/ui/toast";
import { decodeStoreError, storeErrorMessage } from "@/lib/errors";

const AUTO_BATCH = "auto";

interface SaleLine {
  key: number;
  product: Product;
  batchId: string;
  quantity: number | null;
  quantityUnit: "unit" | "pack";
  pricingMode: "price" | "discount";
  salePrice: number | null;
  discount: number | null;
}

interface InvoiceCreateState {
  customerName: string;
  lines: SaleLine[];
  bulkDiscount: number | null;
  pickerKey: number;
}

interface InvoiceCreateActions {
  addProduct: (product: Product) => void;
  updateLine: (key: number, changes: Partial<SaleLine>) => void;
  setLineQuantityUnit: (key: number, quantityUnit: SaleLine["quantityUnit"]) => void;
  removeLine: (key: number) => void;
  setCustomerName: (value: string) => void;
  setBulkDiscount: (value: number | null) => void;
  completeSale: () => Promise<void>;
}

interface InvoiceCreateMeta {
  products: readonly Product[];
  errors: Array<string | null>;
  subtotal: number;
  discountTotal: number;
  total: number;
  validBulkDiscount: boolean;
  canSubmit: boolean;
}

interface InvoiceCreateContextValue {
  state: InvoiceCreateState;
  actions: InvoiceCreateActions;
  meta: InvoiceCreateMeta;
}

const InvoiceCreateContext = createContext<InvoiceCreateContextValue | null>(null);

const suggestedPrice = (product: Product, quantityUnit: SaleLine["quantityUnit"]) =>
  quantityUnit === "pack" ? product.packPrice : product.unitPrice;

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
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1)
    return "Quantity must be 1 or more.";
  const available = availableStock(line);
  if (quantity > available) {
    const label = line.quantityUnit === "pack" ? "packs" : "units";
    return available === 0 ? "Out of stock." : `Only ${available} ${label} in stock.`;
  }
  if (line.pricingMode === "price") {
    if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0)
      return "Enter a sale price.";
  } else {
    if (suggestedPrice(line.product, line.quantityUnit) == null)
      return `Set a ${line.quantityUnit} price before discounting.`;
    if (line.discount == null || line.discount < 0 || line.discount > 100)
      return "Discount must be between 0% and 100%.";
  }
  return null;
};

const lineSalePrice = (line: SaleLine) => {
  if (line.pricingMode === "price") {
    if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0)
      return null;
    return Math.round(line.salePrice * 100);
  }

  const basePrice = suggestedPrice(line.product, line.quantityUnit);
  if (basePrice == null || line.discount == null || line.discount < 0 || line.discount > 100)
    return null;
  return Math.round(basePrice * (1 - line.discount / 100));
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

function InvoiceCreateProvider({
  children,
  products,
}: {
  children: ReactNode;
  products: readonly Product[];
}) {
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [bulkDiscount, setBulkDiscount] = useState<number | null>(0);
  const [pickerKey, setPickerKey] = useState(0);

  const addProduct = (product: Product) => {
    setPickerKey((key) => key + 1);
    setLines((current) => {
      const existing = current.find(
        (line) => line.product.id === product.id && line.batchId === AUTO_BATCH,
      );
      if (existing) {
        return current.map((line) =>
          line === existing ? { ...line, quantity: (line.quantity ?? 0) + 1 } : line,
        );
      }
      return [
        ...current,
        {
          key: Date.now() + current.length,
          product,
          batchId: AUTO_BATCH,
          quantity: 1,
          quantityUnit: "unit",
          pricingMode: "price",
          salePrice: paisaToRupees(suggestedPrice(product, "unit")),
          discount: 0,
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
              salePrice:
                line.pricingMode === "price"
                  ? paisaToRupees(suggestedPrice(line.product, quantityUnit))
                  : line.salePrice,
            }
          : line,
      ),
    );
  };

  const removeLine = (key: number) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const errors = lines.map(lineError);
  const subtotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
  const validBulkDiscount = bulkDiscount != null && bulkDiscount >= 0 && bulkDiscount <= 100;
  const total = validBulkDiscount
    ? lines.reduce((sum, line) => sum + (lineTotal(line, bulkDiscount) ?? 0), 0)
    : subtotal;
  const discountTotal = subtotal - total;
  const canSubmit =
    lines.length > 0 && errors.every((error) => error === null) && validBulkDiscount;

  const completeSale = async () => {
    try {
      const invoice = await window.offlineStore.createInvoice({
        customerName: customerName.trim() || null,
        items: lines.map((line) => ({
          productId: line.product.id,
          batchId: line.batchId === AUTO_BATCH ? null : line.batchId,
          quantity: line.quantity!,
          quantityType: line.quantityUnit,
          salePrice: discountedSalePrice(line, bulkDiscount!)!,
        })),
      });
      toastManager.add({
        title: `Invoice #${formatInvoiceNumber(invoice.invoiceNumber)} created`,
        type: "success",
      });
      await navigate({ to: "/invoices/$invoiceId", params: { invoiceId: invoice.id } });
    } catch (error) {
      const storeError = decodeStoreError(error);
      toastManager.add({
        title:
          storeError?._tag === "PersistenceError"
            ? "Saving failed locally — your data is safe, try again."
            : storeErrorMessage(error),
        type: "error",
      });
    }
  };

  return (
    <InvoiceCreateContext
      value={{
        state: { customerName, lines, bulkDiscount, pickerKey },
        actions: {
          addProduct,
          updateLine,
          setLineQuantityUnit,
          removeLine,
          setCustomerName,
          setBulkDiscount,
          completeSale,
        },
        meta: {
          products,
          errors,
          subtotal,
          discountTotal,
          total,
          validBulkDiscount,
          canSubmit,
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
