import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot, type Plugin } from "vite";
import electron from "vite-plugin-electron/simple";
import { defineConfig, lazyPlugins } from "vite-plus";

import { oxcReactCompiler } from "../web/vite-plugin-oxc-react-compiler";
import packageJson from "./package.json";

const webRoot = path.resolve(__dirname, "../web");

/**
 * Shared index.html boots `main.tsx` (browser SQLite). Packaged Electron must
 * not emit that graph. After-pack scans every renderer chunk for schema SQL,
 * including unused async splits.
 */
const desktopRendererEntry = (): Plugin => ({
  name: "desktop-renderer-entry",
  // Run before Vite collects HTML module entries. A default-order transform
  // leaves `/src/main.tsx` as the build input and packs the browser SQLite
  // host plus migration SQL into the renderer.
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      return html.replace("/src/main.tsx", "/src/main.electron.tsx");
    },
  },
});

/** Use the orange mark for the boot splash and favicon during `vp dev`. */
const desktopDevSplash = (): Plugin => ({
  name: "desktop-dev-splash",
  transformIndexHtml(html) {
    if (process.env.NODE_ENV === "production") return html;
    return html
      .replaceAll("/logo-light.svg", "/logo-dev.svg")
      .replaceAll("/logo-dark.svg", "/logo-dev.svg")
      .replaceAll('href="/logo.svg"', 'href="/logo-dev.svg"');
  },
});

export default defineConfig({
  root: webRoot,
  envDir: __dirname,
  publicDir: path.join(webRoot, "public"),
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    "import.meta.env.VITE_ELECTRON": true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(__dirname), webRoot, __dirname],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "dist-electron/**"],
  },
  lint: {
    env: { node: true, es2020: true },
    ignorePatterns: ["dist/**", "dist-electron/**"],
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { maxWarnings: 0 },
  },
  plugins: lazyPlugins(() => [
    desktopRendererEntry(),
    desktopDevSplash(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: path.join(webRoot, "src/routes"),
      generatedRouteTree: path.join(webRoot, "src/routeTree.gen.ts"),
    }),
    tailwindcss(),
    react(),
    oxcReactCompiler(),
    electron({
      main: {
        entry: path.join(__dirname, "electron/main.ts"),
        // Vite `root` is the renderer in apps/web. Electron must still start
        // from this package so it can resolve `main` in package.json.
        onstart({ startup }) {
          void startup([".", "--no-sandbox"], { cwd: __dirname });
        },
        // Native libSQL packages must remain external and unpacked from asar.
        vite: {
          build: {
            outDir: path.resolve(__dirname, "dist-electron"),
            rolldownOptions: {
              external: [/^@libsql(\/|$)/, "libsql", "electron-updater"],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            outDir: path.resolve(__dirname, "dist-electron"),
          },
        },
      },
      renderer:
        process.env.NODE_ENV === "test"
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ]),
});
