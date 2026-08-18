import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";

import { StoreProvider, type Store } from "@/lib/store";

import { storeStub } from "./store-stub";

afterEach(cleanup);

export const renderWithRouter = (ui: ReactNode) => {
  const rootRoute = createRootRoute({
    component: () => null,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const productRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/products/$productId",
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute, productRoute]),
  });
  return { ...render(<RouterContextProvider router={router}>{ui}</RouterContextProvider>), router };
};

export const renderWithStore = (ui: ReactNode, store: Store = storeStub()) =>
  renderWithRouter(<StoreProvider store={store}>{ui}</StoreProvider>);
