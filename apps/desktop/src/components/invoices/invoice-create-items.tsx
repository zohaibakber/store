import { ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { InvoiceCreateLine } from "@/components/invoices/invoice-create-line";
import { InvoiceProductPicker } from "@/components/invoices/invoice-product-picker";

function EmptyInvoiceItems() {
  return (
    <Empty className="border border-dashed rounded-2xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={ShoppingBasket01Icon} />
        </EmptyMedia>
        <EmptyTitle>Nothing added yet</EmptyTitle>
        <EmptyDescription>Search above to add items to this sale.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function InvoiceItems() {
  const {
    state: { lines },
    meta: { errors },
  } = useInvoiceCreate();

  return (
    <div className="flex flex-col gap-3">
      <InvoiceProductPicker />
      {lines.length === 0 ? (
        <EmptyInvoiceItems />
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <InvoiceCreateLine error={errors[index]} key={line.key} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

export { InvoiceItems };
