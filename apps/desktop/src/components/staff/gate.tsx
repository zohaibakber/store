import { SquareLock02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { permits, type StaffId, type StaffState } from "@store/contracts";
import { useCatalogIsReady, useCommand, useStaffState } from "@store/inventory-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import {
  landingPath,
  routePermission,
  StaffAccessContext,
  stateLandingPath,
  useStaffAccess,
  type LandingPath,
} from "@/components/staff/access";
import { LockScreen } from "@/components/staff/lock-screen";
import {
  RecoveryCode,
  StaffScreen,
  StaffScreenHeader,
  StaffScreenLoading,
  WRITTEN_DOWN,
} from "@/components/staff/screen";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useIdleLock } from "@/hooks/use-idle-lock";

export function StaffGate({ children }: { readonly children: ReactNode }) {
  if (!useCatalogIsReady()) return <StaffScreenLoading />;
  return <ReadyStaffGate>{children}</ReadyStaffGate>;
}

function useArrival(state: StaffState | undefined) {
  const navigate = useNavigate();
  const [settled, setSettled] = useState<StaffId | null>(null);
  const [viaLock, setViaLock] = useState(false);
  const actor = state?._tag === "unlocked" ? state.actor : null;
  const changed = actor !== null && actor.id !== settled;

  if (state?._tag === "locked" && !viaLock) setViaLock(true);
  if (actor !== null && !changed && viaLock) setViaLock(false);
  if (changed && !viaLock) setSettled(actor.id);

  const arrivingId = changed && viaLock ? actor.id : null;
  const destination: LandingPath = actor === null ? "/" : landingPath(actor.role);

  useEffect(() => {
    if (arrivingId === null) return;
    let current = true;
    void navigate({ to: destination }).finally(() => {
      if (!current) return;
      setSettled(arrivingId);
      setViaLock(false);
    });
    return () => {
      current = false;
    };
  }, [arrivingId, destination, navigate]);

  return { arriving: arrivingId !== null, lastActorId: settled };
}

function ReadyStaffGate({ children }: { readonly children: ReactNode }) {
  const state = useStaffState();
  const [lock] = useCommand((commands) => commands.staff.lock);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const { arriving, lastActorId } = useArrival(state);

  useIdleLock(state?._tag === "unlocked" ? state.autoLockMinutes : null, () => {
    void lock();
  });

  if (recoveryCode !== null) {
    return (
      <StaffScreen>
        <StaffScreenHeader title="The owner PIN is reset. Write down the new recovery code." />
        <RecoveryCode code={recoveryCode} />
        <Button onClick={() => setRecoveryCode(null)} type="button">
          {WRITTEN_DOWN}
        </Button>
      </StaffScreen>
    );
  }
  if (state === undefined || arriving) return <StaffScreenLoading />;
  if (state._tag === "locked") {
    return (
      <LockScreen lastActorId={lastActorId} onRecovered={setRecoveryCode} staff={state.staff} />
    );
  }
  return <StaffAccessContext value={state}>{children}</StaffAccessContext>;
}

export function StaffRouteGuard({ children }: { readonly children: ReactNode }) {
  const state = useStaffAccess();
  const pathname = useRouterState({
    select: (router) => router.matches.at(-1)?.pathname ?? router.location.pathname,
  });
  if (permits(state, routePermission(pathname))) return children;
  const landing = stateLandingPath(state);

  return (
    <Empty className="min-h-[calc(100svh-4rem)]" data-testid="staff-forbidden">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={SquareLock02Icon} />
        </EmptyMedia>
        <EmptyTitle>Your role does not allow this</EmptyTitle>
        <EmptyDescription>Ask the owner or a manager.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to={landing} />} size="sm">
          {landing === "/" ? "Return home" : "Go to New Sale"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
