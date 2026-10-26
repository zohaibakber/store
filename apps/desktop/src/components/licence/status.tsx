import { useLicenceState } from "@store/inventory-react";

import { licenceStatusCopy } from "@/components/licence/copy";

export function LicenceStatus() {
  const state = useLicenceState();
  if (state === undefined || state._tag === "missing") return null;
  const status = licenceStatusCopy(state);

  return (
    <span
      className="grid min-w-0 leading-tight"
      data-state={state._tag}
      data-testid="licence-status"
    >
      <span className="truncate text-sm font-medium" data-testid="licence-shop-name">
        {state.licence.shopName}
      </span>
      {status === undefined ? null : (
        <span className="truncate text-xs text-muted-foreground" data-testid="licence-status-line">
          {status}
        </span>
      )}
    </span>
  );
}
