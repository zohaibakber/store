import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import type { HostAccessPolicy } from "@/host-access";
import type { InitialAuth } from "@/lib/auth";
import type { InventoryHost } from "@/lib/inventory-host";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
  /** When true, beforeLoad skips admit redirects until AuthProvider clears it. */
  readonly sessionPending?: boolean;
  readonly inventory?: InventoryHost;
}) => {
  const router = getRouter({
    history: input.history,
    initialAuth: input.initialAuth,
    access: input.access,
    sessionPending: input.sessionPending ?? false,
    inventory: input.inventory,
  });
  const app = <RouterProvider router={router} />;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>{app}</ThemeProvider>
    </React.StrictMode>,
  );
};
