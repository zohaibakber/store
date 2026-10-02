import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Plugin } from "vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import packageJson from "./package.json";
import { webAppConfig } from "./vite.app";

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
            "script-src 'self' https://static.cloudflareinsights.com",
            [
              "connect-src 'self'",
              ...connectOrigins,
              "https://*.ingest.sentry.io",
              "https://*.ingest.us.sentry.io",
              "https://cloudflareinsights.com",
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

const app = webAppConfig({ version: packageJson.version, signedInApp: "deferred" });

const server = { host: "localhost", port: 5174, strictPort: true };

export default defineConfig({
  define: app.define,
  resolve: app.resolve,
  worker: app.worker,
  build: { outDir: "dist", emptyOutDir: true },
  server,
  preview: server,
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, node: true, es2020: true },
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
  plugins: lazyPlugins(async () => [...app.plugins(), webContentSecurityPolicy()]),
});
