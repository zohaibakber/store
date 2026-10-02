import type { CatalogLifetime, InventoryHost } from "@store/inventory-react";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { RouteError } from "@/components/app/route-error";
import type { HostAccessPolicy } from "@/host-access";
import type { ReplayChannel } from "@/host/replay-channel";
import { routeTree } from "@/routeTree.gen";
import type { WorkspaceSession } from "@/session/workspace-session";

export const getRouter = (input: {
  readonly history: RouterHistory;
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly inventory?: InventoryHost;
  readonly registry: AtomRegistry.AtomRegistry;
}) =>
  createRouter({
    routeTree,
    context: {
      session: input.session,
      catalog: input.catalog,
      access: input.access,
      inventory: input.inventory ?? null,
      registry: input.registry,
    },
    history: input.history,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultStaleReloadMode: "blocking",
    defaultGcTime: 60_000,
    defaultPreloadGcTime: 15_000,
    scrollRestoration: true,
    scrollToTopSelectors: ["[data-scroll-restoration-id='app-content']"],
    defaultErrorComponent: RouteError,
  });

type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
