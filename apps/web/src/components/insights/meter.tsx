import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/utils";

import type { Tone } from "./presentation";

export type MeterTone = Tone | "chart";

const INDICATOR = {
  error: "**:data-[slot=meter-indicator]:bg-destructive",
  warning: "**:data-[slot=meter-indicator]:bg-warning",
  info: "**:data-[slot=meter-indicator]:bg-info",
  success: "**:data-[slot=meter-indicator]:bg-success",
  secondary: "**:data-[slot=meter-indicator]:bg-muted-foreground/64",
  chart: "**:data-[slot=meter-indicator]:bg-chart-1",
} satisfies Record<MeterTone, string>;

export function InsightMeter({
  className,
  label,
  max,
  tone = "chart",
  value,
}: {
  readonly className?: string;
  readonly label: string;
  readonly max: number;
  readonly tone?: MeterTone;
  readonly value: number;
}) {
  const bound = max > 0 ? max : 1;
  return (
    <div className={cn("min-w-0", INDICATOR[tone], className)}>
      <Meter aria-label={label} max={bound} value={Math.min(Math.max(value, 0), bound)} />
    </div>
  );
}
