import { defineConfig, lazyPlugins } from "vite-plus";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "dist-electron/**", "src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, es2020: true },
    ignorePatterns: ["dist/**", "dist-electron/**", "src/routeTree.gen.ts"],
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
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        // PGlite loads its PostgreSQL WASM and data assets at runtime, so keep the
        // package intact for electron-builder instead of folding it into main.js.
        // This must also cover subpaths like `@electric-sql/pglite/contrib/pg_trgm`:
        // when bundled, each contrib module inlines its `*.tar.gz` as a `data:` URL,
        // but PGlite's Node loader reads bundles via `fs.createReadStream` and can
        // only handle `file://` paths — so a bundled contrib makes `CREATE EXTENSION`
        // fail. Keeping the subpaths external preserves their on-disk tarball URLs.
        vite: {
          build: {
            rolldownOptions: {
              external: [/^@electric-sql\/pglite(\/|$)/, "electron-updater"],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, "electron/preload.ts"),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === "test"
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ]),
});
