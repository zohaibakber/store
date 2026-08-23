import type { WorkspaceSnapshot } from "@store/contracts";
import { createRouter, type RouterHistory } from "@tanstack/react-router";

import type { HostAccessPolicy } from "@/host-access";
import type { InitialAuth } from "@/lib/auth";
import type { InventoryHost } from "@/lib/inventory-host";
import { routeTree } from "@/routeTree.gen";

const sessionSnapshotFromAuth = (initialAuth: InitialAuth): WorkspaceSnapshot | null =>
  initialAuth._tag === "Session" ? initialAuth.snapshot : null;

export const getRouter = (input: {
  readonly history: RouterHistory;
  readonly initialAuth: InitialAuth;
  readonly access: HostAccessPolicy;
  readonly sessionPending?: boolean;
  readonly inventory?: InventoryHost;
}) =>
  createRouter({
    routeTree,
    context: {
      initialAuth: input.initialAuth,
      /** Live workspace snapshot; updated on every session publish before invalidate. */
      sessionSnapshot: sessionSnapshotFromAuth(input.initialAuth),
      sessionPending: input.sessionPending ?? false,
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
