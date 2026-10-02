import { CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense } from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { PublishProgressBar } from "@/components/app/publish-progress";
import { Button } from "@/components/ui/button";
import { catalogContents } from "@/lib/catalog-counts";
import {
  useLocalPublish,
  usePublishTarget,
  type LocalPublish,
  type PublishTarget,
} from "@/lib/local-publish";

const explanationOf = (state: LocalPublish, organization: PublishTarget): string => {
  switch (state._tag) {
    case "Nothing":
      return "";
    case "Offered":
      return `The ${catalogContents(state.counts)} saved on this device move into ${organization.name} and sync from there. A copy stays on this device for 30 days.`;
    case "Occupied":
      return `${organization.name} already has inventory, so the ${catalogContents(state.counts)} on this device stay under This device. A device’s data can only move into an empty organization.`;
    case "Elsewhere":
      return `The ${catalogContents(state.counts)} on this device are waiting to move to ${state.destination}. Open ${state.destination} to finish, or cancel that move to move them here instead. If that move already finished, the data stays there too.`;
    case "Moving":
      return `Moving into ${organization.name}. Keep Tabaaq open until it finishes.`;
    case "Failed":
      return state.message;
  }
};

function PublishSettingsFor({ organization }: { readonly organization: PublishTarget }) {
  const { state, move, cancelElsewhere } = useLocalPublish(organization);
  if (state._tag === "Nothing") return null;
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="min-w-0">
          <p className="text-sm">Move this device’s data to {organization.name}</p>
          <p
            className={
              state._tag === "Failed" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {explanationOf(state, organization)}
          </p>
        </div>
        {state._tag === "Moving" ? <PublishProgressBar progress={state.progress} /> : null}
      </div>
      {state._tag === "Elsewhere" ? (
        <Button className="shrink-0" onClick={cancelElsewhere} size="sm" variant="outline">
          Cancel that move
        </Button>
      ) : (
        <Button
          className="shrink-0"
          disabled={state._tag === "Occupied" || state._tag === "Moving"}
          loading={state._tag === "Moving"}
          onClick={move}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={CloudUploadIcon} />
          {state._tag === "Failed" ? "Try again" : "Move data"}
        </Button>
      )}
    </div>
  );
}

export function PublishSettings() {
  const organization = usePublishTarget();
  if (organization === null) return null;
  return (
    <AppErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <PublishSettingsFor organization={organization} />
      </Suspense>
    </AppErrorBoundary>
  );
}
