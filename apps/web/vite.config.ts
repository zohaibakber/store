import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";
import { oxcReactCompiler } from "./vite-plugin-oxc-react-compiler";

// Non-prod stages (local `dev`) proxy `/api` on the Website origin. A baked
// production `VITE_API_URL` would CORS-fail from `*.workers.dev`.
if (process.env.STAGE && process.env.STAGE !== "prod") {
  process.env.VITE_API_URL = "";
}

const defaultCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: ws: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

const contentSecurityPolicyPlugin = (): Plugin => ({
  name: "content-security-policy",
  // Dev leaves CSP off so Alchemy's Cloudflare Vite plugin can open the
  // module-runner WebSocket on 127.0.0.1. Packaged Electron applies CSP from
  // the main process instead.
  apply: "build",
  transformIndexHtml(html) {
    return html.replace(
      "</title>",
      `</title>\n    <meta http-equiv="Content-Security-Policy" content="${defaultCsp}" />`,
    );
  },
});

/** Electron uses the same renderer with a different host entry and history. */
const desktopRendererEntry = (): Plugin => ({
  name: "desktop-renderer-entry",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      return html.replace("/src/main.tsx", "/src/main.electron.tsx");
    },
  },
});

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

export default defineConfig(({ mode }) => {
  const isDesktopRenderer = mode === "desktop" || process.env["STORE_DESKTOP_RENDERER"] === "1";

  return {
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      "import.meta.env.VITE_ELECTRON": isDesktopRenderer,
    },
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      exclude: ["@powersync/web", "@journeyapps/wa-sqlite"],
    },
    worker: {
      format: "es",
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
      ...(isDesktopRenderer
        ? [desktopRendererEntry(), desktopDevSplash()]
        : [contentSecurityPolicyPlugin()]),
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      tailwindcss(),
      react(),
      oxcReactCompiler(),
    ]),
  };
});
