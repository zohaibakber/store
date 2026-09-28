import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DEFAULT_STOCK_POLICY, type StockPolicy } from "@store/services/insights";
import * as React from "react";

import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
} from "@/components/shared/control-group";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toastManager } from "@/components/ui/toast";
import { useStockPolicy } from "@/lib/inventory";

type WholeKey = Exclude<keyof StockPolicy, "serviceLevel">;

const WHOLE_FIELDS: ReadonlyArray<{
  readonly key: WholeKey;
  readonly label: string;
  readonly description: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}> = [
  {
    key: "leadDays",
    label: "Supplier lead time",
    description: "Days between placing an order and stock on the shelf.",
    unit: "days",
    min: 0,
    max: 90,
  },
  {
    key: "coverDays",
    label: "Order cover",
    description: "How long each order should last after it arrives.",
    unit: "days",
    min: 1,
    max: 120,
  },
  {
    key: "minimumUnits",
    label: "Minimum on shelf",
    description: "Reorder below this, unless stock already lasts a full order cycle.",
    unit: "units",
    min: 0,
    max: 10_000,
  },
  {
    key: "expiryWarningDays",
    label: "Expiry warning",
    description: "Flag batches expiring within this window.",
    unit: "days",
    min: 7,
    max: 365,
  },
  {
    key: "deadStockDays",
    label: "Not selling after",
    description: "Stock with no sales this long counts as dead stock.",
    unit: "days",
    min: 14,
    max: 365,
  },
  {
    key: "overstockDays",
    label: "Overstock above",
    description: "More cover than this is capital sitting idle.",
    unit: "days",
    min: 30,
    max: 730,
  },
];

const SERVICE_LEVELS = [
  { value: "0.9", label: "90%" },
  { value: "0.95", label: "95%" },
  { value: "0.975", label: "97.5%" },
  { value: "0.99", label: "99%" },
] as const;

type ServiceLevelValue = (typeof SERVICE_LEVELS)[number]["value"];

const closestServiceLevel = (level: number): ServiceLevelValue =>
  SERVICE_LEVELS.reduce((best, option) =>
    Math.abs(Number(option.value) - level) < Math.abs(Number(best.value) - level) ? option : best,
  ).value;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

function PlanningForm({
  initial,
  onSave,
}: {
  readonly initial: StockPolicy;
  readonly onSave: (policy: StockPolicy) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const field = (key: WholeKey, value: number | null) =>
    setDraft((current) => ({ ...current, [key]: value ?? current[key] }));

  return (
    <Form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          ...Object.fromEntries(
            WHOLE_FIELDS.map((entry) => [entry.key, clamp(draft[entry.key], entry.min, entry.max)]),
          ),
        });
      }}
    >
      <SheetPanel>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>Service level</FieldLabel>
            <SegmentedRadio
              label="Service level"
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, serviceLevel: Number(value) }))
              }
              options={SERVICE_LEVELS}
              value={closestServiceLevel(draft.serviceLevel)}
            />
            <FieldDescription>
              Chance of not running out during a delivery. Best sellers get 2 points more, the long
              tail 5 points less.
            </FieldDescription>
          </Field>
          {WHOLE_FIELDS.map((entry) => (
            <Field key={entry.key}>
              <FieldLabel>{entry.label}</FieldLabel>
              <div className="w-40">
                <ControlGroup>
                  <ControlGroupNumberInput
                    aria-label={entry.label}
                    inputProps={{ "aria-label": entry.label }}
                    max={entry.max}
                    min={entry.min}
                    onValueChange={(value) => field(entry.key, value)}
                    step={1}
                    value={draft[entry.key]}
                  />
                  <ControlGroupAddon>
                    <ControlGroupText>{entry.unit}</ControlGroupText>
                  </ControlGroupAddon>
                </ControlGroup>
              </div>
              <FieldDescription>{entry.description}</FieldDescription>
            </Field>
          ))}
        </div>
      </SheetPanel>
      <SheetFooter>
        <Button onClick={() => setDraft(DEFAULT_STOCK_POLICY)} type="button" variant="ghost">
          Reset
        </Button>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <Button type="submit">Save</Button>
      </SheetFooter>
    </Form>
  );
}

export function PlanningSheet() {
  const [policy, setPolicy] = useStockPolicy();
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger render={<Button size="sm" variant="outline" />}>
        <HugeiconsIcon aria-hidden="true" icon={Settings02Icon} />
        Planning
      </SheetTrigger>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Planning settings</SheetTitle>
          <SheetDescription>
            Reorder points, order sizes, and alerts use these. They are saved on this device.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <PlanningForm
            initial={policy}
            onSave={(next) => {
              setPolicy(next);
              setOpen(false);
              toastManager.add({ title: "Planning settings saved", type: "success" });
            }}
          />
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
