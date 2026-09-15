import type { StockPolicy } from "@store/services/stock-recommendations";
import { useState } from "react";

import { Input } from "@/components/ui/input";

const policyFields: ReadonlyArray<{
  key: keyof StockPolicy;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "leadDays", label: "Delivery time (days)", min: 0, max: 90 },
  { key: "safetyDays", label: "Safety stock (days)", min: 0, max: 30 },
  { key: "coverDays", label: "Stock after delivery (days)", min: 1, max: 90 },
  { key: "minimumUnits", label: "Minimum stock (units)", min: 0, max: 10000 },
];

function PlanningField({
  field,
  initialValue,
  onCommit,
}: {
  field: (typeof policyFields)[number];
  initialValue: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(initialValue));
  return (
    <label className="space-y-1">
      <span>{field.label}</span>
      <Input
        type="number"
        min={field.min}
        max={field.max}
        step={1}
        required
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => onCommit(event.target.valueAsNumber)}
      />
    </label>
  );
}

export function StockPlanning({
  policy,
  onPolicyChange,
}: {
  policy: StockPolicy;
  onPolicyChange: (policy: StockPolicy) => void;
}) {
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">
        Planning assumptions & how this works
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {policyFields.map((field) => (
          <PlanningField
            key={field.key}
            field={field}
            initialValue={policy[field.key]}
            onCommit={(value) => onPolicyChange({ ...policy, [field.key]: value })}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Planning values apply to this visit. With at least 44 days of product history, we compare
        7-day and 30-day averages against the last 14 days of sales, using only earlier sales for
        each prediction. The average with the lower daily error determines estimated demand.
        Otherwise we use a 30-day average adjusted for product age. This daily test does not measure
        accuracy across the full purchasing period.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Suggested buys cover delivery time plus desired coverage and safety stock, rounded to whole
        packs where applicable. At least 14 days of product history and sales on 5 days are needed
        to suggest a quantity. Trend labels mean daily sales changed by at least 25% between the
        last 7 days and the preceding 23 days. These cutoffs are planning rules.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Estimates use sales saved on this device. Stockouts can hide demand; seasonal changes and
        outstanding supplier orders are not included. Check existing orders and expiry risk before
        purchasing. Export includes the complete suggested buy list.
      </p>
    </details>
  );
}
