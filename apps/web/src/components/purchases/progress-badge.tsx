import type { PurchaseOrderProgress } from "@store/contracts";

import type { Tone } from "@/components/insights/presentation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { PROGRESS_META } from "./presentation";

const DOT = {
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
  secondary: "bg-muted-foreground/64",
} satisfies Record<Tone, string>;

export function ProgressBadge({ progress }: { readonly progress: PurchaseOrderProgress }) {
  const meta = PROGRESS_META[progress];
  return (
    <Badge title={meta.hint} variant="outline">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[meta.tone])} />
      {meta.label}
    </Badge>
  );
}
