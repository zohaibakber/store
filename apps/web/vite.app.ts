import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter, type CodeSplittingOptions } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, PluginOption } from "vite";

export const webRoot = import.meta.dirname;

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

const signedInApp = {
  deferred: {
    defaultBehavior: [["loader", "component"], ["errorComponent"], ["notFoundComponent"]],
  },
  eager: {
    splitBehavior: ({ routeId }) => (routeId === "/_app" ? [] : undefined),
  },
} satisfies Record<string, CodeSplittingOptions>;

export const webAppConfig = (input: {
  readonly version: string;
  readonly signedInApp: keyof typeof signedInApp;
}) => ({
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
      codeSplittingOptions: signedInApp[input.signedInApp],
      routesDirectory: path.join(webRoot, "src/routes"),
      generatedRouteTree: path.join(webRoot, "src/routeTree.gen.ts"),
    }),
    tailwindcss(),
    react({ compiler: true }),
  ],
});
