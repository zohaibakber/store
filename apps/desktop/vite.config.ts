import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";

const webRoot = path.resolve(__dirname, "../web");

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
      allow: [webRoot, __dirname],
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
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: path.join(webRoot, "src/routes"),
      generatedRouteTree: path.join(webRoot, "src/routeTree.gen.ts"),
    }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    electron({
      main: {
        entry: path.join(__dirname, "electron/main.ts"),
        // Native libSQL and Clerk passkey packages must remain external and
        // unpacked from asar. Bundling the passkey loader also breaks its
        // __dirname-based platform binary lookup.
        vite: {
          build: {
            outDir: path.resolve(__dirname, "dist-electron"),
            rolldownOptions: {
              external: [
                /^@clerk\/electron-passkeys(\/|$|-)/,
                /^@libsql(\/|$)/,
                "libsql",
                "electron-updater",
              ],
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
