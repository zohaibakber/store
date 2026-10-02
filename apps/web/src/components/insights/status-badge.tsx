import type { StockStatus } from "@store/contracts";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { STATUS_META, type Tone } from "./presentation";

const DOT = {
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
  secondary: "bg-muted-foreground/64",
} satisfies Record<Tone, string>;

function ToneDot({ tone }: { readonly tone: Tone }) {
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />;
}

export function StatusDot({ status }: { readonly status: StockStatus }) {
  return <ToneDot tone={STATUS_META[status].tone} />;
}

export function ToneBadge({
  hint,
  label,
  tone,
}: {
  readonly hint: string;
  readonly label: string;
  readonly tone: Tone;
}) {
  return (
    <Badge title={hint} variant="outline">
      <ToneDot tone={tone} />
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { readonly status: StockStatus }) {
  return <ToneBadge {...STATUS_META[status]} />;
}

export function StatusLabel({ status }: { readonly status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5" title={meta.hint}>
      <ToneDot tone={meta.tone} />
      {meta.label}
    </span>
  );
}
