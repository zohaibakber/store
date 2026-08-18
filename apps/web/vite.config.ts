import path from "node:path";

import babel from "@rolldown/plugin-babel";
import { clerkFrontendApiHostnameFromPublishableKey } from "@store/auth/security";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";

const desktopSrc = path.resolve(__dirname, "../desktop/src");
const clerkAccountsDev = /(^|\.)clerk\.accounts\.dev$/iu;

/** Custom Clerk FAPI origin for CSP. Test keys on *.clerk.accounts.dev need no extra host. */
const clerkFrontendApiOrigin = () => {
  const explicit = process.env.VITE_CLERK_FAPI_URL?.trim();
  if (explicit) {
    try {
      const url = explicit.includes("://") ? new URL(explicit) : new URL(`https://${explicit}`);
      return url.origin;
    } catch {
      return undefined;
    }
  }
  const key = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!key) return undefined;
  try {
    const hostname = clerkFrontendApiHostnameFromPublishableKey(key);
    if (clerkAccountsDev.test(hostname)) return undefined;
    return `https://${hostname}`;
  } catch {
    return undefined;
  }
};

const clerkCspPlugin = (): Plugin => ({
  name: "clerk-fapi-csp",
  transformIndexHtml(html) {
    const extra = clerkFrontendApiOrigin();
    if (!extra) return html;
    return html.replace("https://*.clerk.accounts.dev", `https://*.clerk.accounts.dev ${extra}`);
  },
});

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
  plugins: lazyPlugins(() => [
    clerkCspPlugin(),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ]),
});
