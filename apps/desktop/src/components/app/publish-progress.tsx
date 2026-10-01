import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import type { PublishProgress } from "@/lib/workspace-publish";

const percentOf = (progress: PublishProgress | null) =>
  progress === null || progress.total === 0
    ? null
    : Math.min(100, Math.round((progress.sent / progress.total) * 100));

const stepOf = (progress: PublishProgress | null) => {
  if (progress === null) return "Reading this device’s data";
  if (progress.sent >= progress.total) return "Finishing up";
  return `${formatNumber(progress.sent)} of ${formatNumber(progress.total)} records sent`;
};

export function PublishProgressBar({ progress }: { readonly progress: PublishProgress | null }) {
  return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <Progress aria-label="Moving this device’s data" value={percentOf(progress)} />
      <p className="text-xs text-muted-foreground tabular-nums">{stepOf(progress)}</p>
    </div>
  );
}
