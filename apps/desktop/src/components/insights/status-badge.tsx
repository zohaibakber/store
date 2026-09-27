import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { Tone } from "./presentation";

const DOT = {
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
  secondary: "bg-muted-foreground/64",
} satisfies Record<Tone, string>;

export function ToneDot({ tone }: { readonly tone: Tone }) {
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />;
}

export function StatusBadge({ label, tone }: { readonly label: string; readonly tone: Tone }) {
  return (
    <Badge variant="outline">
      <ToneDot tone={tone} />
      {label}
    </Badge>
  );
}
