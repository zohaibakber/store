import { defineConfig } from "vite-plus";

const development = process.env["STORE_DESKTOP_DEV"] === "1";
const electronMainBundleDeps = [
  /^@tanstack\//u,
  /^@sentry\//u,
  /^@opentelemetry\//u,
  /^ms(?:\/|$)/u,
  /^debug(?:\/|$)/u,
  /^supports-color(?:\/|$)/u,
  /^module-details-from-path(?:\/|$)/u,
  /^require-in-the-middle(?:\/|$)/u,
  /^import-in-the-middle(?:\/|$)/u,
];
const rendererConfig = {
  "import.meta.env.PROD": JSON.stringify(!development),
  "import.meta.env.VITE_API_URL": JSON.stringify(process.env["VITE_API_URL"] ?? ""),
  "import.meta.env.VITE_AUTH_URL": JSON.stringify(process.env["VITE_AUTH_URL"] ?? ""),
  "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env["VITE_SENTRY_DSN"] ?? ""),
};

export default defineConfig({
  pack: [
    {
      entry: ["electron/main.ts"],
      format: "esm",
      outDir: "dist-electron",
      outExtensions: () => ({ js: ".js" }),
      sourcemap: true,
      clean: true,
      define: rendererConfig,
      deps: {
        alwaysBundle: electronMainBundleDeps,
        neverBundle: ["better-sqlite3", "electron", "electron-updater"],
        onlyBundle: [...electronMainBundleDeps, /^effect(?:\/|$)/u],
      },
      onSuccess: development ? "node scripts/dev-electron.mjs" : undefined,
    },
    {
      entry: ["electron/preload.ts"],
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      define: rendererConfig,
      deps: {
        neverBundle: ["electron"],
      },
    },
  ],
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
});
