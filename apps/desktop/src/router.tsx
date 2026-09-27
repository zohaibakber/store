import type { CatalogLifetime, InventoryHost } from "@store/inventory-react";
import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { RouteError } from "@/components/app/route-error";
import type { HostAccessPolicy } from "@/host-access";
import type { ReplayChannel } from "@/replay-channel";
import { routeTree } from "@/routeTree.gen";
import type { WorkspaceSession } from "@/session/workspace-session";

const replicaCatalogPreload = false;

export const getRouter = (input: {
  readonly history: RouterHistory;
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly inventory?: InventoryHost;
}) =>
  createRouter({
    routeTree,
    context: {
      session: input.session,
      catalog: input.catalog,
      access: input.access,
      inventory: input.inventory ?? null,
    },
    history: input.history,
    defaultPreload: replicaCatalogPreload,
    defaultGcTime: 60_000,
    defaultPreloadGcTime: 15_000,
    scrollRestoration: true,
    defaultPendingComponent: PageSkeleton,
    defaultErrorComponent: RouteError,
  });

type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
