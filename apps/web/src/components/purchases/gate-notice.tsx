import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchasingGate } from "@store/inventory-react";
import { Link } from "@tanstack/react-router";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function PurchasingGateNotice({ gate }: { readonly gate: PurchasingGate }) {
  const owns = useAuth().snapshot?.activeOrganization?.role === "owner";
  if (!gate.blocked) return null;
  return (
    <Alert variant="warning">
      <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
      <AlertDescription>{gate.message}</AlertDescription>
      {owns ? (
        <AlertAction>
          <Button
            render={<Link params={{ section: "organization" }} to="/settings/$section" />}
            size="sm"
            variant="outline"
          >
            Review devices
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
