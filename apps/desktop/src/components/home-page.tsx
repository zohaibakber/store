import type { SyncPhase, SyncStatus } from "@store/contracts";
import { Link } from "@tanstack/react-router";
import { Alert02Icon, ArrowRight01Icon, CloudIcon, CloudOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialStatus: SyncStatus = {
  phase: "local-only",
  configured: false,
  lastSyncedAt: null,
  message: "Loading local database…",
};

const phaseBadge: Record<
  SyncPhase,
  { label: string; variant: "outline" | "secondary" | "destructive"; className?: string }
> = {
  "local-only": { label: "Local only", variant: "outline" },
  idle: {
    label: "Cloud ready",
    variant: "secondary",
    className: "bg-info/10 text-info-foreground",
  },
  syncing: {
    label: "Syncing",
    variant: "secondary",
    className: "bg-warning/10 text-warning-foreground",
  },
  error: { label: "Sync paused", variant: "destructive" },
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Something unexpected happened";

export function HomePage() {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await window.offlineStore.getSyncStatus());
  }, []);

  useEffect(() => {
    refresh().catch((cause: unknown) => setError(errorMessage(cause)));
  }, [refresh]);

  useEffect(() => {
    const handleSync = () => {
      void refresh().catch((cause: unknown) => setError(errorMessage(cause)));
    };

    window.addEventListener("offline-store:sync", handleSync);
    return () => window.removeEventListener("offline-store:sync", handleSync);
  }, [refresh]);

  const badge = phaseBadge[status.phase];

  return (
    <PageLayout>
      <PageHeader>
        <p className="font-medium text-primary text-sm">Offline-first store</p>
        <PageHeading>Welcome back</PageHeading>
        <PageDescription className="max-w-2xl">
          Every edit is committed to the on-device PostgreSQL database first. Background sync never
          blocks local work.
        </PageDescription>
      </PageHeader>

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {status.configured ? (
                <HugeiconsIcon aria-hidden="true" icon={CloudIcon} />
              ) : (
                <HugeiconsIcon aria-hidden="true" icon={CloudOffIcon} />
              )}
              Sync status
            </CardTitle>
            <CardDescription>{status.message}</CardDescription>
            <CardAction>
              <Badge className={badge.className} variant={badge.variant}>
                {badge.label}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <strong className="font-medium">Storage:</strong>{" "}
              <span className="text-muted-foreground">local database</span>
            </span>
            <span>
              <strong className="font-medium">Last sync:</strong>{" "}
              <span className="text-muted-foreground">
                {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
              </span>
            </span>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>Operation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
            <CardDescription>
              Browse and manage everything the shop sells — stock, prices and batches.
            </CardDescription>
            <CardAction>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/products">
                Open products
                <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
              </Link>
            </CardAction>
          </CardHeader>
        </Card>
      </PageContent>
    </PageLayout>
  );
}
