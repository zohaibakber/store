import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchasingGate } from "@store/inventory-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export function PurchasingGateNotice({ gate }: { readonly gate: PurchasingGate }) {
  if (!gate.blocked) return null;
  return (
    <Alert variant="warning">
      <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
      <AlertDescription>{gate.message}</AlertDescription>
    </Alert>
  );
}
