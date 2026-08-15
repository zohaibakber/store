import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";

const desktopSrc = path.resolve(__dirname, "../desktop/src");

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  publicDir: path.resolve(__dirname, "../desktop/public"),
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@/lib/clerk-runtime": path.resolve(__dirname, "src/clerk-runtime.ts"),
      "@": desktopSrc,
      "@libsql/client": "@libsql/client-wasm",
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
  lint: {
    env: { browser: true, es2020: true },
    ignorePatterns: ["dist/**", "infra.ts"],
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
  plugins: lazyPlugins(() => [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })]),
});
