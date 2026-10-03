import { useId, useState } from "react";

import { ReceiptSheet } from "@/components/receipts/document";
import { SAMPLE_RECEIPT } from "@/components/receipts/receipt";
import { FrameCard } from "@/components/shared/frame-card";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useEditReceiptFormat,
  useOrganizationName,
  useReceiptFormat,
} from "@/hooks/use-receipt-format";
import {
  RECEIPT_TEXT_LIMITS,
  receiptStoreName,
  type ReceiptPaper,
  type RollWidth,
} from "@/lib/receipt-format";

const PAPER_OPTIONS = [
  { value: "a4", label: "A4" },
  { value: "thermal", label: "Thermal" },
] as const satisfies ReadonlyArray<{ value: ReceiptPaper; label: string }>;

const ROLL_WIDTH_OPTIONS = [
  { value: "80", label: "80 mm" },
  { value: "58", label: "58 mm" },
] as const;

const ROLL_WIDTH_OF = { "58": 58, "80": 80 } as const satisfies Record<
  (typeof ROLL_WIDTH_OPTIONS)[number]["value"],
  RollWidth
>;

function Choice({
  children,
  description,
  title,
}: {
  readonly children: React.ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function ReceiptSettings() {
  const id = useId();
  const format = useReceiptFormat();
  const edit = useEditReceiptFormat();
  const organizationName = useOrganizationName();
  const [preview, setPreview] = useState<ReceiptPaper>(format.paper);

  return (
    <FrameCard description="Saved on this device" title="Receipts">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-store-name`}>Store name</FieldLabel>
            <Input
              id={`${id}-store-name`}
              maxLength={RECEIPT_TEXT_LIMITS.storeName}
              onChange={(event) => edit({ storeName: event.target.value })}
              placeholder={organizationName ?? "e.g. Ali's Pharmacy"}
              value={format.storeName}
            />
            {organizationName === null ? null : (
              <FieldDescription>Leave blank to print the organization name.</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-phone`}>Phone</FieldLabel>
            <Input
              id={`${id}-phone`}
              maxLength={RECEIPT_TEXT_LIMITS.phone}
              onChange={(event) => edit({ phone: event.target.value })}
              placeholder="e.g. 042 3571 0000"
              value={format.phone}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-address`}>Address</FieldLabel>
            <Textarea
              id={`${id}-address`}
              maxLength={RECEIPT_TEXT_LIMITS.address}
              onChange={(event) => edit({ address: event.target.value })}
              placeholder="Shop, street and city"
              value={format.address}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-registration`}>Licence and tax numbers</FieldLabel>
            <Textarea
              id={`${id}-registration`}
              maxLength={RECEIPT_TEXT_LIMITS.registration}
              onChange={(event) => edit({ registration: event.target.value })}
              placeholder="e.g. NTN 1234567-8"
              value={format.registration}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${id}-footer`}>Footer note</FieldLabel>
            <Textarea
              id={`${id}-footer`}
              maxLength={RECEIPT_TEXT_LIMITS.footer}
              onChange={(event) => edit({ footer: event.target.value })}
              placeholder="e.g. return policy or a thank-you line"
              value={format.footer}
            />
          </Field>
        </div>

        <Separator />

        <Choice
          description="What Print uses. The other layout stays in the Print menu."
          title="Default paper"
        >
          <SegmentedRadio
            label="Default paper"
            onValueChange={(paper) => {
              edit({ paper });
              setPreview(paper);
            }}
            options={PAPER_OPTIONS}
            value={format.paper}
          />
        </Choice>
        <Choice description="The roll the thermal printer takes." title="Thermal roll width">
          <SegmentedRadio
            label="Thermal roll width"
            onValueChange={(width) => {
              edit({ rollWidth: ROLL_WIDTH_OF[width] });
              setPreview("thermal");
            }}
            options={ROLL_WIDTH_OPTIONS}
            value={`${format.rollWidth}`}
          />
        </Choice>
        <Choice description="Print the batch number of every line." title="Batch numbers">
          <Switch
            aria-label="Batch numbers"
            checked={format.showBatch}
            onCheckedChange={(showBatch) => edit({ showBatch })}
          />
        </Choice>
        <Choice
          description="Open the print dialog as soon as a sale is completed."
          title="Print after each sale"
        >
          <Switch
            aria-label="Print after each sale"
            checked={format.printAfterSale}
            onCheckedChange={(printAfterSale) => edit({ printAfterSale })}
          />
        </Choice>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">Preview</p>
          <SegmentedRadio
            label="Preview paper"
            onValueChange={setPreview}
            options={PAPER_OPTIONS}
            value={preview}
          />
        </div>
        <div className="overflow-x-auto rounded-lg bg-muted p-4" data-paper-preview="">
          <ReceiptSheet
            className="mx-auto shadow-sm"
            format={format}
            paper={preview}
            receipt={SAMPLE_RECEIPT}
            storeName={receiptStoreName(format, organizationName)}
          />
        </div>
      </div>
    </FrameCard>
  );
}
