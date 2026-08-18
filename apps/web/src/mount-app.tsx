import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import type { InitialAuth } from "@/lib/auth";
import { StoreProvider, type Store } from "@/lib/store";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  readonly history: RouterHistory;
  readonly clerk: (app: React.ReactElement) => React.ReactElement;
}) => {
  const router = getRouter(input.history, input.store, input.initialAuth);
  const app = (
    <ThemeProvider>
      <StoreProvider store={input.store}>
        <RouterProvider router={router} />
      </StoreProvider>
    </ThemeProvider>
  );
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{input.clerk(app)}</React.StrictMode>,
  );
};
