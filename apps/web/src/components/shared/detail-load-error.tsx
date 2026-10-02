import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function DetailLoadError({
  children,
  error,
  subject,
}: {
  readonly children?: ReactNode;
  readonly error: unknown;
  readonly subject: string;
}) {
  const alert = (
    <Alert variant="error">
      <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
      <AlertTitle>{`Could not load ${subject}`}</AlertTitle>
      <AlertDescription>
        {error instanceof Error ? error.message : `The ${subject} could not be loaded.`}
      </AlertDescription>
    </Alert>
  );
  return (
    <PageLayout width="narrow">
      {children === undefined ? (
        alert
      ) : (
        <PageContent>
          {alert}
          <div>{children}</div>
        </PageContent>
      )}
    </PageLayout>
  );
}
