import { clerkFrontendApiHostnameFromPublishableKey } from "@store/auth/security";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";
import { oxcReactCompiler } from "./vite-plugin-oxc-react-compiler";

const clerkAccountsDev = /(^|\.)clerk\.accounts\.dev$/iu;

const defaultCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' https://*.clerk.accounts.dev https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://img.clerk.com; font-src 'self' data:; connect-src 'self' https: ws: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-src 'self' https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'";

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
  // Dev leaves CSP off so Alchemy's Cloudflare Vite plugin can open the
  // module-runner WebSocket on 127.0.0.1. Packaged Electron applies CSP from
  // the main process instead.
  apply: "build",
  transformIndexHtml(html) {
    const extra = clerkFrontendApiOrigin();
    const policy = extra
      ? defaultCsp.replace("https://*.clerk.accounts.dev", `https://*.clerk.accounts.dev ${extra}`)
      : defaultCsp;
    return html.replace(
      "</title>",
      `</title>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    );
  },
});

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    "import.meta.env.VITE_ELECTRON": false,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@libsql/client": "@libsql/client-wasm",
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
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
    ignorePatterns: ["dist/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, es2020: true },
    ignorePatterns: ["dist/**", "infra.ts", "src/routeTree.gen.ts"],
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
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    oxcReactCompiler(),
  ]),
});
