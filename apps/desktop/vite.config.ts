import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import electron from "vite-plugin-electron/simple";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";

const updateChannel = process.env["STORE_UPDATE_CHANNEL"] ?? "latest";
const electronDefines = {
  __UPDATE_CHANNEL__: JSON.stringify(updateChannel),
  "import.meta.env.VITE_API_URL": JSON.stringify(process.env["VITE_API_URL"] ?? ""),
  "import.meta.env.VITE_AUTH_URL": JSON.stringify(process.env["VITE_AUTH_URL"] ?? ""),
  "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env["VITE_SENTRY_DSN"] ?? ""),
};

const desktopDevSplash = (): Plugin => ({
  name: "desktop-dev-splash",
  apply: "serve",
  transformIndexHtml(html) {
    return html
      .replaceAll("/logo-light.svg", "/logo-dev.svg")
      .replaceAll("/logo-dark.svg", "/logo-dev.svg")
      .replaceAll('href="/logo.svg"', 'href="/logo-dev.svg"');
  },
});

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  worker: {
    format: "es",
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "dist-electron/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, node: true, es2020: true },
    ignorePatterns: ["dist/**", "dist-electron/**", "src/routeTree.gen.ts"],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "react/exhaustive-deps": "warn",
      "react/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: ["Route"] },
      ],
      "react/rules-of-hooks": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { maxWarnings: 0 },
  },
  plugins: lazyPlugins(async () => [
    desktopDevSplash(),
    ...(await electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          define: electronDefines,
          build: {
            outDir: "dist-electron",
            emptyOutDir: command === "build",
            sourcemap: true,
            rolldownOptions: {
              input: {
                main: path.resolve("electron/main.ts"),
                "replica-worker": path.resolve("electron/replica-worker.ts"),
              },
              external: ["electron", "electron-updater"],
              output: { entryFileNames: "[name].js" },
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          define: electronDefines,
          build: {
            outDir: "dist-electron",
            emptyOutDir: false,
            sourcemap: true,
            rolldownOptions: {
              external: ["electron"],
              output: { entryFileNames: "preload.cjs" },
            },
          },
        },
      },
    })),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react({ compiler: true }),
  ]),
}));
