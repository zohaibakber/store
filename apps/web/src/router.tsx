import type { WorkspaceSnapshot } from "@store/contracts";
import { createRouter, type RouterHistory } from "@tanstack/react-router";

import type { HostAccessPolicy } from "@/host-access";
import type { InitialAuth } from "@/lib/auth";
import type { Store } from "@/lib/store";
import { routeTree } from "@/routeTree.gen";

const sessionSnapshotFromAuth = (initialAuth: InitialAuth): WorkspaceSnapshot | null =>
  initialAuth._tag === "Session" ? initialAuth.snapshot : null;

export const getRouter = (input: {
  readonly history: RouterHistory;
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly access: HostAccessPolicy;
}) =>
  createRouter({
    routeTree,
    context: {
      store: input.store,
      initialAuth: input.initialAuth,
      /** Live workspace snapshot; updated on every session publish before invalidate. */
      sessionSnapshot: sessionSnapshotFromAuth(input.initialAuth),
      access: input.access,
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
