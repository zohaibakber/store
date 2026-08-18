import { createRouter, type RouterHistory } from "@tanstack/react-router";

import type { InitialAuth } from "@/lib/auth";
import type { Store } from "@/lib/store";
import { routeTree } from "@/routeTree.gen";

export const getRouter = (history: RouterHistory, store: Store, initialAuth: InitialAuth) =>
  createRouter({
    routeTree,
    context: { store, initialAuth },
    history,
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
