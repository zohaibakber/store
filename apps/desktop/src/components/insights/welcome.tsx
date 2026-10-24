import { Add01Icon, FileImportIcon, Login01Icon, PackageIcon } from "@hugeicons/core-free-icons";
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
import type { Workspace } from "@/host-access";
import { useAuth } from "@/lib/auth";

const savedWhere = (workspace: Workspace): string => {
  switch (workspace._tag) {
    case "None":
      return "";
    case "Local":
      return "Everything you add is saved on this device.";
    case "Organization":
      return `Everything you add syncs to ${workspace.organization.name}.`;
  }
};

export function Welcome() {
  const { snapshot, workspace } = useAuth();
  const signedIn = snapshot?.status === "authenticated";
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
        </EmptyMedia>
        <EmptyTitle>Add your first product</EmptyTitle>
        <EmptyDescription>
          Enter products one at a time or import them from a CSV file. {savedWhere(workspace)}
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
        {signedIn ? null : (
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-muted-foreground">
              Already keep your stock in Tabaaq on another device?
            </p>
            <Button render={<Link to="/sign-in" />} size="sm" variant="ghost">
              <HugeiconsIcon aria-hidden="true" icon={Login01Icon} />
              Sign in
            </Button>
          </div>
        )}
      </EmptyContent>
    </Empty>
  );
}
