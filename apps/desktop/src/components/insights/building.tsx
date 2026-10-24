import { ChartLineData02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AnalyticsStatus } from "@store/contracts";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";

import { progressPercent } from "./presentation";

export function InsightsBuilding({ status }: { readonly status: AnalyticsStatus }) {
  const { progress, failure } = status;
  const value = progressPercent(progress);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={ChartLineData02Icon} />
        </EmptyMedia>
        <EmptyTitle>
          {failure === null ? "Building your insights" : "Insights unavailable"}
        </EmptyTitle>
        <EmptyDescription>
          {failure === null
            ? "Sales, stock and reorder plans are calculated in the background across your whole catalog. This page fills in as soon as the first pass finishes."
            : failure}
        </EmptyDescription>
      </EmptyHeader>
      {failure === null && value !== null ? (
        <Progress aria-label="Insights progress" className="max-w-xs" value={value} />
      ) : null}
    </Empty>
  );
}
