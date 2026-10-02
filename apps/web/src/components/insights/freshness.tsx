import type { AnalyticsStatus } from "@store/contracts";

import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/format";
import { useInventoryInsights } from "@/lib/inventory";

import { progressPercent } from "./presentation";

const progressLabel = (status: AnalyticsStatus) => {
  const percent = progressPercent(status.progress);
  return percent === null ? null : `${percent}%`;
};

const describeFreshness = (input: {
  readonly status: AnalyticsStatus;
  readonly completedAt: number | null;
}): string => {
  const { status, completedAt } = input;
  if (status.failure !== null && status.state === "idle") {
    return completedAt === null
      ? "Couldn't build insights"
      : `Couldn't refresh · from ${formatRelativeTime(completedAt)}`;
  }
  if (completedAt === null) {
    const percent = progressLabel(status);
    return percent === null ? "Building insights" : `Building insights ${percent}`;
  }
  const from = formatRelativeTime(completedAt);
  if (status.state === "idle") return `Updated ${from}`;
  const percent = progressLabel(status);
  const reason = status.policyCurrent ? "Updating" : "Applying new settings";
  return `${reason}${percent === null ? "" : ` ${percent}`} · from ${from}`;
};

export function InsightsFreshness() {
  const { summary, status, refreshing } = useInventoryInsights();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
      role="status"
    >
      {refreshing ? <Spinner className="size-3.5" /> : null}
      {describeFreshness({ status, completedAt: summary?.run.completedAt ?? null })}
    </span>
  );
}
