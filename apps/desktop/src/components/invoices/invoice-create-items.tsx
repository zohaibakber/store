import { ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { InvoiceCreateLine } from "@/components/invoices/invoice-create-line";
import { InvoiceProductPicker } from "@/components/invoices/invoice-product-picker";

function EmptyInvoiceItems() {
  return (
    <Empty className="border border-dashed">
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
    <>
      <CardHeader>
        <CardTitle>Items</CardTitle>
        <CardDescription>Quantities are counted in units.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InvoiceProductPicker />
        {lines.length === 0 ? (
          <EmptyInvoiceItems />
        ) : (
          <ItemGroup className="gap-2">
            {lines.map((line, index) => (
              <InvoiceCreateLine error={errors[index]} key={line.key} line={line} />
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </>
  );
}

export { InvoiceItems };
