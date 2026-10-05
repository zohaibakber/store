import { Add01Icon, FileImportIcon, PackageIcon } from "@hugeicons/core-free-icons";
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

export function Welcome() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
        </EmptyMedia>
        <EmptyTitle>Add your first product</EmptyTitle>
        <EmptyDescription>
          Enter products one at a time or import them from a CSV file. Everything you add is saved
          on this device.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button render={<Link to="/products/new" />} size="sm">
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            Add a product
          </Button>
          <Button render={<Link to="/products/upload" />} size="sm" variant="outline">
            <HugeiconsIcon aria-hidden="true" icon={FileImportIcon} />
            Import a CSV
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
