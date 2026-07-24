import type { SyncPhase, SyncStatus } from "@store/contracts";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

const phaseBadge: Record<
  SyncPhase,
  { label: string; variant: "outline" | "info" | "warning" | "error" }
> = {
  "local-only": { label: "Local only", variant: "outline" },
  idle: { label: "Cloud ready", variant: "info" },
  syncing: { label: "Syncing", variant: "warning" },
  error: { label: "Sync paused", variant: "error" },
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const badge = phaseBadge[status.phase];
  const lastSynced = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString()
    : "Never synced";

  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant={badge.variant} />}>{badge.label}</TooltipTrigger>
      <TooltipPopup>
        {status.message} · Last sync: {lastSynced}
      </TooltipPopup>
    </Tooltip>
  );
}
