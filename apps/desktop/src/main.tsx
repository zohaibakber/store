import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import { bootstrapAuth, type InitialAuth } from "@/lib/auth";
import { electronStore, StoreProvider } from "@/lib/store";
import { routeTree } from "@/routeTree.gen";

import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles.css";

const store = electronStore();

const createAppRouter = (initialAuth: InitialAuth) =>
  createRouter({
    routeTree,
    context: { store, initialAuth },
    history: createHashHistory(),
    defaultPreload: "intent",
    scrollRestoration: true,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

async function start() {
  const router = createAppRouter(await bootstrapAuth());
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <StoreProvider store={store}>
          <RouterProvider router={router} />
        </StoreProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
  const loader = document.getElementById("app-loading");
  requestAnimationFrame(() => {
    loader?.classList.add("app-loading-hidden");
    loader?.addEventListener("transitionend", () => loader.remove(), { once: true });
  });
}

void start();
