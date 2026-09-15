import { createRouter, type RouterHistory } from "@tanstack/react-router";

import type { HostAccessPolicy } from "@/host-access";
import type { InventoryHost } from "@/lib/inventory-host";
import type { CatalogLifetime } from "@/lib/inventory/lifetime";
import type { ReplayChannel } from "@/replay-channel";
import { routeTree } from "@/routeTree.gen";
import type { WorkspaceSession } from "@/session/workspace-session";

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
    // Route data comes from the local replica. Speculative hover preloads can
    // materialize an entire catalog the user never opens.
    defaultPreload: false,
    defaultGcTime: 60_000,
    defaultPreloadGcTime: 15_000,
    scrollRestoration: true,
  });

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
