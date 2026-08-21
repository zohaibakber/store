import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import type { HostAccessPolicy } from "@/host-access";
import type { InitialAuth } from "@/lib/auth";
import { StoreProvider, type Store } from "@/lib/store";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
}) => {
  const router = getRouter({
    history: input.history,
    store: input.store,
    initialAuth: input.initialAuth,
    access: input.access,
  });
  const app = (
    <StoreProvider store={input.store}>
      <RouterProvider router={router} />
    </StoreProvider>
  );
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>{app}</ThemeProvider>
    </React.StrictMode>,
  );
};
