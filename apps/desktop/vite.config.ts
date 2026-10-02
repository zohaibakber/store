/// <reference types="vite-plugin-electron/electron-env" />
import path from "node:path";

import { webAppConfig, webRoot } from "@store/web/vite";
import type { ElectronOptions } from "vite-plugin-electron";
import electron from "vite-plugin-electron/simple";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";

const desktopRoot = import.meta.dirname;
const electronSource = path.join(desktopRoot, "electron");
const electronOutput = path.join(desktopRoot, "dist-electron");

const electronDefines = {
  __APP_VERSION__: JSON.stringify(packageJson.version),
  "import.meta.env.VITE_API_URL": JSON.stringify(process.env["VITE_API_URL"] ?? ""),
  "import.meta.env.VITE_AUTH_URL": JSON.stringify(process.env["VITE_AUTH_URL"] ?? ""),
  "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env["VITE_SENTRY_DSN"] ?? ""),
};

const app = webAppConfig({ version: packageJson.version, signedInApp: "eager" });

type ElectronStart = NonNullable<ElectronOptions["onstart"]>;

const startElectron: ElectronStart = ({ startup }) => {
  void startup(undefined, { cwd: desktopRoot });
};

const reloadRenderer: ElectronStart = (start) =>
  process.electronApp ? start.reload() : startElectron(start);

export default defineConfig(({ command }) => ({
  root: webRoot,
  envDir: desktopRoot,
  define: app.define,
  resolve: app.resolve,
  worker: app.worker,
  build: { outDir: path.join(desktopRoot, "dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "dist-electron/**"],
  },
  lint: {
    env: { browser: true, node: true, es2020: true },
    ignorePatterns: ["dist/**", "dist-electron/**"],
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { maxWarnings: 0 },
  },
  plugins: lazyPlugins(async () => [
    ...app.plugins(),
    ...(await electron({
      main: {
        entry: path.join(electronSource, "main.ts"),
        onstart: startElectron,
        vite: {
          root: desktopRoot,
          define: electronDefines,
          build: {
            outDir: electronOutput,
            emptyOutDir: command === "build",
            sourcemap: true,
            rolldownOptions: {
              input: {
                main: path.join(electronSource, "main.ts"),
                "replica-worker": path.join(electronSource, "replica-worker.ts"),
                "replica-reader": path.join(electronSource, "replica-reader.ts"),
                "analytics-worker": path.join(electronSource, "analytics-worker.ts"),
              },
              external: ["electron", "electron-updater"],
              output: { entryFileNames: "[name].js" },
            },
          },
        },
      },
      preload: {
        input: path.join(electronSource, "preload.ts"),
        onstart: reloadRenderer,
        vite: {
          root: desktopRoot,
          define: electronDefines,
          build: {
            outDir: electronOutput,
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
  ]),
}));
