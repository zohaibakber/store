import type { LicenceState } from "@store/contracts";
import { useLicenceState } from "@store/inventory-react";
import { useState, type ReactNode } from "react";

import { ENTER_NEW_LICENCE } from "@/components/licence/copy";
import { LicenceDialog } from "@/components/licence/dialog";
import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

const DAY_MILLIS = 86_400_000;

const days = (count: number) => formatCount(count, "day");

const daysLeftCopy = (state: Exclude<LicenceState, { _tag: "missing" }>, now: number): string => {
  switch (state._tag) {
    case "valid":
      return days(Math.max(1, Math.ceil((state.licence.expiresAt - now) / DAY_MILLIS)));
    case "expiring":
      return days(state.daysLeft);
    case "grace":
      return `Ended. Sales stop in ${days(state.daysLeft)}`;
    case "expired":
      return "Ended";
  }
};

function StatusBadge({ state }: { readonly state: Exclude<LicenceState, { _tag: "missing" }> }) {
  switch (state._tag) {
    case "valid":
      return <Badge variant="success">Active</Badge>;
    case "expiring":
      return <Badge variant="warning">Ends soon</Badge>;
    case "grace":
      return <Badge variant="warning">Ended</Badge>;
    case "expired":
      return <Badge variant="error">Ended</Badge>;
  }
}

function Row({
  children,
  handle,
  label,
}: {
  readonly children: ReactNode;
  readonly handle: string;
  readonly label: string;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate tabular-nums" data-testid={handle}>
        {children}
      </dd>
    </div>
  );
}

export function LicenceSettings() {
  const state = useLicenceState();
  const [entering, setEntering] = useState(false);
  const [now] = useState(() => Date.now());

  if (state === undefined) return null;
  const held = state._tag === "missing" ? null : state;

  return (
    <FrameCard
      action={
        <Button onClick={() => setEntering(true)} size="sm" type="button" variant="outline">
          {ENTER_NEW_LICENCE}
        </Button>
      }
      data-state={state._tag}
      data-testid="licence-settings"
      description={held === null ? undefined : <StatusBadge state={held} />}
      title="Licence"
    >
      {held === null ? (
        <p className="text-sm text-muted-foreground">This computer has no licence yet.</p>
      ) : (
        <dl className="flex flex-col divide-y text-sm">
          <Row handle="licence-shop" label="Shop">
            {held.licence.shopName}
          </Row>
          <Row handle="licence-number" label="Licence number">
            <span className="select-all">{held.licence.id}</span>
          </Row>
          <Row handle="licence-issued" label="Issued">
            {formatDate(held.licence.issuedAt)}
          </Row>
          <Row handle="licence-expires" label={held.licence.expiresAt > now ? "Ends" : "Ended"}>
            {formatDate(held.licence.expiresAt)}
          </Row>
          <Row handle="licence-days-left" label="Days left">
            {daysLeftCopy(held, now)}
          </Row>
          <Row handle="licence-backup" label="Cloud backup">
            {held.licence.backup === null ? "Not included" : "Included"}
          </Row>
        </dl>
      )}
      {entering ? <LicenceDialog onClose={() => setEntering(false)} /> : null}
    </FrameCard>
  );
}
