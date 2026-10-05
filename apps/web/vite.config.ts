import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts"],
  },
  lint: {
    env: { browser: true, node: true, es2020: true },
    ignorePatterns: ["src/routeTree.gen.ts"],
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
});
