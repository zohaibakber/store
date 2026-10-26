import { RouteBlockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/shared/page-layout";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function DetailNotFound({
  children,
  title,
}: {
  readonly children?: ReactNode;
  readonly title: string;
}) {
  return (
    <PageLayout width="narrow">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon aria-hidden="true" icon={RouteBlockIcon} />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>It may have been deleted, or the link is out of date.</EmptyDescription>
        </EmptyHeader>
        {children === undefined ? null : <EmptyContent>{children}</EmptyContent>}
      </Empty>
    </PageLayout>
  );
}
