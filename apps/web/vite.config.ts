import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";
import { oxcReactCompiler } from "./vite-plugin-oxc-react-compiler";

/** Use the development mark for Electron's boot splash and favicon. */
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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    "import.meta.env.VITE_ELECTRON": true,
  },
  resolve: {
    tsconfigPaths: true,
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
    ignorePatterns: ["dist/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, es2020: true },
    ignorePatterns: ["dist/**", "src/routeTree.gen.ts"],
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
  plugins: lazyPlugins(() => [
    desktopDevSplash(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    oxcReactCompiler(),
  ]),
});
