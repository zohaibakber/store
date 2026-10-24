import { Home01Icon, RouteBlockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function NotFound() {
  return (
    <Empty className="min-h-[calc(100svh-4rem)]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={RouteBlockIcon} />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>No page at this address.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} size="sm">
          <HugeiconsIcon aria-hidden="true" icon={Home01Icon} />
          Return home
        </Button>
      </EmptyContent>
    </Empty>
  );
}
