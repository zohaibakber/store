import { Alert02Icon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense, useEffect } from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { PublishProgressBar } from "@/components/app/publish-progress";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  catalogContents,
  useLocalPublish,
  usePublishOfferDismissal,
  usePublishTarget,
  type PublishTarget,
} from "@/lib/local-publish";

function PublishOfferFor({ organization }: { readonly organization: PublishTarget }) {
  const { state, move, cancelElsewhere } = useLocalPublish(organization);
  const { dismissed, dismiss } = usePublishOfferDismissal(organization);
  const resuming = state._tag === "Offered" && state.resuming;

  useEffect(() => {
    if (resuming) move();
  }, [resuming, move]);

  switch (state._tag) {
    case "Nothing":
    case "Occupied":
      return null;
    case "Offered":
      if (state.resuming || dismissed) return null;
      return (
        <div className="px-4 pt-2">
          <Alert variant="info">
            <HugeiconsIcon aria-hidden="true" icon={CloudUploadIcon} />
            <AlertTitle>Move this device’s data to {organization.name}?</AlertTitle>
            <AlertDescription>
              {`The ${catalogContents(state.counts)} saved on this device move into ${organization.name} and sync from there. A copy stays on this device for 30 days.`}
            </AlertDescription>
            <AlertAction>
              <Button onClick={dismiss} size="xs" variant="ghost">
                Not now
              </Button>
              <Button onClick={move} size="xs">
                Move data
              </Button>
            </AlertAction>
          </Alert>
        </div>
      );
    case "Elsewhere":
      if (dismissed) return null;
      return (
        <div className="px-4 pt-2">
          <Alert variant="warning">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>This device’s data is waiting to move to {state.destination}</AlertTitle>
            <AlertDescription>
              {`Open ${state.destination} to finish that move, or cancel it to move the ${catalogContents(state.counts)} here instead. If that move already finished, the data stays there too.`}
            </AlertDescription>
            <AlertAction>
              <Button onClick={dismiss} size="xs" variant="ghost">
                Not now
              </Button>
              <Button onClick={cancelElsewhere} size="xs" variant="outline">
                Cancel that move
              </Button>
            </AlertAction>
          </Alert>
        </div>
      );
    case "Moving":
      return (
        <div className="px-4 pt-2">
          <Alert aria-busy="true" variant="info">
            <HugeiconsIcon aria-hidden="true" icon={CloudUploadIcon} />
            <AlertTitle>Moving this device’s data to {organization.name}</AlertTitle>
            <AlertDescription>
              <PublishProgressBar progress={state.progress} />
            </AlertDescription>
          </Alert>
        </div>
      );
    case "Failed":
      return (
        <div className="px-4 pt-2">
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>The move to {organization.name} did not finish</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
            <AlertAction>
              <Button onClick={move} size="xs" variant="outline">
                Try again
              </Button>
            </AlertAction>
          </Alert>
        </div>
      );
  }
}

export function PublishOffer() {
  const organization = usePublishTarget();
  if (organization === null) return null;
  return (
    <AppErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <PublishOfferFor organization={organization} />
      </Suspense>
    </AppErrorBoundary>
  );
}
