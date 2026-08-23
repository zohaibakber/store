import { defineConfig } from "vite-plus";

const development = process.env["STORE_DESKTOP_DEV"] === "1";
const rendererConfig = {
  "import.meta.env.PROD": JSON.stringify(!development),
  "import.meta.env.VITE_API_URL": JSON.stringify(process.env["VITE_API_URL"] ?? ""),
  "import.meta.env.VITE_AUTH_URL": JSON.stringify(process.env["VITE_AUTH_URL"] ?? ""),
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
        alwaysBundle: [/^@tanstack\//u],
        neverBundle: ["better-sqlite3", "electron", "electron-updater"],
        onlyBundle: [/^@tanstack\//u, /^effect(?:\/|$)/u],
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
