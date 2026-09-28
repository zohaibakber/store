import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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

const WEB_ORIGIN_FALLBACKS = {
  VITE_API_URL: "http://localhost:8787",
  VITE_AUTH_URL: "http://localhost:8788",
} as const;

const decodeDefinedString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String));

const webContentSecurityPolicy = (): Plugin => {
  let connectOrigins: ReadonlyArray<string> = [];
  return {
    name: "web-content-security-policy",
    apply: "build",
    configResolved(config) {
      const origins = (["VITE_API_URL", "VITE_AUTH_URL"] as const).map((key) => {
        const configured = decodeDefinedString(config.define?.[`import.meta.env.${key}`]).pipe(
          Option.orElse(() => Option.fromNullishOr(config.env[key])),
          Option.map((value) => value.trim()),
          Option.filter((value) => value.length > 0),
          Option.getOrElse(() => WEB_ORIGIN_FALLBACKS[key]),
        );
        return new URL(configured).origin;
      });
      const apiSocket = new URL(origins[0] ?? WEB_ORIGIN_FALLBACKS.VITE_API_URL);
      apiSocket.protocol = apiSocket.protocol === "https:" ? "wss:" : "ws:";
      connectOrigins = [...new Set([...origins, apiSocket.origin])];
    },
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: [
            "default-src 'self'",
            "script-src 'self'",
            [
              "connect-src 'self'",
              ...connectOrigins,
              "https://*.ingest.sentry.io",
              "https://*.ingest.us.sentry.io",
            ].join(" "),
            "img-src 'self' data: blob: https:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "worker-src 'self'",
            "form-action 'self'",
            "object-src 'none'",
            "base-uri 'self'",
          ].join("; "),
        },
        injectTo: "head-prepend",
      },
    ],
  };
};

const isWebBuild = (mode: string) =>
  mode === "web" || process.env["ALCHEMY_CLOUDFLARE_VITE_INJECTED"] === "1";

const webServer = { host: "localhost", port: 5174, strictPort: true };

export default defineConfig(({ command, mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  worker: {
    format: "es",
  },
  build: isWebBuild(mode) ? { outDir: "dist-web", emptyOutDir: true } : {},
  server: isWebBuild(mode)
    ? webServer
    : {
        host: "127.0.0.1",
        port: 5174,
        strictPort: true,
      },
  preview: isWebBuild(mode) ? webServer : {},
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "dist-web/**", "dist-electron/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, node: true, es2020: true },
    ignorePatterns: ["dist/**", "dist-web/**", "dist-electron/**", "src/routeTree.gen.ts"],
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
    ...(isWebBuild(mode)
      ? [webContentSecurityPolicy()]
      : await electron({
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
