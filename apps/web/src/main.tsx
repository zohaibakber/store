import { ClerkProvider } from "@clerk/clerk-react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import { bootstrapAuth, setAuthSessionBridge, type InitialAuth } from "@/lib/auth";
import { ClerkWorkspaceSync, clerkPublishableKey } from "@/lib/clerk-workspace";
import { StoreProvider, type Store } from "@/lib/store";
import { routeTree } from "@/routeTree.gen";

import { startWebWorkspace } from "./host";

import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./styles.css";

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const createAppRouter = (store: Store, initialAuth: InitialAuth) =>
  createRouter({
    routeTree,
    context: { store, initialAuth },
    defaultPreload: "intent",
    scrollRestoration: true,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

async function start() {
  const { bridge, store } = await startWebWorkspace(apiBaseUrl);
  setAuthSessionBridge(bridge);
  const router = createAppRouter(store, await bootstrapAuth());
  const app = (
    <ThemeProvider>
      <StoreProvider store={store}>
        <RouterProvider router={router} />
      </StoreProvider>
    </ThemeProvider>
  );
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {clerkPublishableKey ? (
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <ClerkWorkspaceSync />
          {app}
        </ClerkProvider>
      ) : (
        app
      )}
    </React.StrictMode>,
  );
  const loader = document.getElementById("app-loading");
  requestAnimationFrame(() => {
    loader?.classList.add("app-loading-hidden");
    loader?.addEventListener("transitionend", () => loader.remove(), { once: true });
  });
}

void start();
