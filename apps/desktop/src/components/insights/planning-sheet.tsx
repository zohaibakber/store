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
import { FrameCard } from "@/components/shared/frame-card";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { Button } from "@/components/ui/button";
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

type WholeField = {
  readonly key: WholeKey;
  readonly label: string;
  readonly description: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly group: "reorder" | "alerts";
};

const WHOLE_FIELDS: ReadonlyArray<WholeField> = [
  {
    key: "leadDays",
    label: "Supplier lead time",
    description: "Days between placing an order and stock on the shelf.",
    unit: "days",
    min: 0,
    max: 90,
    group: "reorder",
  },
  {
    key: "coverDays",
    label: "Order cover",
    description: "How long each order should last after it arrives.",
    unit: "days",
    min: 1,
    max: 120,
    group: "reorder",
  },
  {
    key: "minimumUnits",
    label: "Minimum on shelf",
    description: "Reorder below this, unless stock already lasts a full order cycle.",
    unit: "units",
    min: 0,
    max: 10_000,
    group: "reorder",
  },
  {
    key: "expiryWarningDays",
    label: "Expiry warning",
    description: "Flag batches expiring within this window.",
    unit: "days",
    min: 7,
    max: 365,
    group: "alerts",
  },
  {
    key: "deadStockDays",
    label: "Not selling after",
    description: "Stock with no sales this long counts as dead stock.",
    unit: "days",
    min: 14,
    max: 365,
    group: "alerts",
  },
  {
    key: "overstockDays",
    label: "Overstock above",
    description: "More cover than this is capital sitting idle.",
    unit: "days",
    min: 30,
    max: 730,
    group: "alerts",
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

function SettingRow({
  children,
  description,
  label,
}: {
  readonly children: React.ReactNode;
  readonly description: string;
  readonly label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

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
  const wholeRow = (entry: WholeField) => (
    <SettingRow description={entry.description} key={entry.key} label={entry.label}>
      <div className="w-28">
        <ControlGroup>
          <ControlGroupNumberInput
            aria-label={entry.label}
            inputProps={{ "aria-label": entry.label, className: "text-end" }}
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
    </SettingRow>
  );

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
          <FrameCard flush title="Reordering">
            <div className="divide-y">
              <SettingRow
                description="Odds of not running out before a delivery. Best sellers +2, long tail −5."
                label="Service level"
              >
                <SegmentedRadio
                  label="Service level"
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, serviceLevel: Number(value) }))
                  }
                  options={SERVICE_LEVELS}
                  value={closestServiceLevel(draft.serviceLevel)}
                />
              </SettingRow>
              {WHOLE_FIELDS.filter((entry) => entry.group === "reorder").map(wholeRow)}
            </div>
          </FrameCard>
          <FrameCard flush title="Alerts">
            <div className="divide-y">
              {WHOLE_FIELDS.filter((entry) => entry.group === "alerts").map(wholeRow)}
            </div>
          </FrameCard>
        </div>
      </SheetPanel>
      <SheetFooter className="sm:justify-between">
        <Button
          onClick={() => setDraft(DEFAULT_STOCK_POLICY)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Reset to defaults
        </Button>
        <div className="flex gap-2">
          <SheetClose render={<Button size="sm" variant="ghost" />}>Cancel</SheetClose>
          <Button size="sm" type="submit">
            Save
          </Button>
        </div>
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
      <SheetPopup className="sm:max-w-xl" variant="inset">
        <SheetHeader>
          <SheetTitle>Planning</SheetTitle>
          <SheetDescription>
            Reorder points, order sizes and alerts use these. Saved on this device.
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
