import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import { DEFAULT_ELECTRON_PROTOCOL } from "@store/auth/security";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import { bootstrapAuth, type InitialAuth } from "@/lib/auth";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";
import { electronStore, StoreProvider } from "@/lib/store";
import { routeTree } from "@/routeTree.gen";

import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles.css";

const store = electronStore();

const createAppRouter = (initialAuth: InitialAuth) =>
  createRouter({
    routeTree,
    context: { store, initialAuth },
    history: createHashHistory(),
    // Route data comes from local SQLite. Speculatively loading it on hover can
    // materialize an entire product catalog that the user never opens.
    defaultPreload: false,
    // Loader results can contain full product graphs. Keep inactive route data
    // briefly for back navigation, then make it eligible for collection.
    defaultGcTime: 60_000,
    defaultPreloadGcTime: 15_000,
    scrollRestoration: true,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

async function start() {
  const router = createAppRouter(await bootstrapAuth());
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
        <ElectronClerkProvider
          allowedRedirectProtocols={[DEFAULT_ELECTRON_PROTOCOL]}
          passkeys={passkeys}
          publishableKey={clerkPublishableKey}
        >
          <ClerkActiveOrganization />
          <ClerkWorkspaceSync />
          {app}
        </ElectronClerkProvider>
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
