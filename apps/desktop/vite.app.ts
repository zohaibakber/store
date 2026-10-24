import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter, type CodeSplittingOptions } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, PluginOption } from "vite";

export const rendererRoot = import.meta.dirname;

const devSplash = (): Plugin => ({
  name: "desktop-dev-splash",
  apply: "serve",
  transformIndexHtml(html) {
    return html
      .replaceAll("/logo-light.svg", "/logo-dev.svg")
      .replaceAll("/logo-dark.svg", "/logo-dev.svg")
      .replaceAll('href="/logo.svg"', 'href="/logo-dev.svg"');
  },
});

const keepShellInStartupBundle: CodeSplittingOptions = {
  splitBehavior: ({ routeId }) => (routeId === "/_app" ? [] : undefined),
};

export const rendererAppConfig = (input: { readonly version: string }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(input.version),
    __SENTRY_DEBUG__: false,
    __SENTRY_TRACING__: false,
  },
  resolve: {
    tsconfigPaths: true,
  },
  worker: {
    format: "es" as const,
  },
  plugins: (): Array<PluginOption> => [
    devSplash(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      codeSplittingOptions: keepShellInStartupBundle,
      routesDirectory: path.join(rendererRoot, "src/routes"),
      generatedRouteTree: path.join(rendererRoot, "src/routeTree.gen.ts"),
    }),
    tailwindcss(),
    react({ compiler: true }),
  ],
});
