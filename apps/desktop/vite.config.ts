import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "dist/**",
      ".vite/**",
      "out/**",
      "release/**",
      "vite.base.config.ts",
      "vite.main.config.ts",
      "vite.preload.config.ts",
      "forge.config.ts",
    ],
  },
  lint: {
    env: { node: true, es2020: true },
    ignorePatterns: [
      "dist/**",
      ".vite/**",
      "out/**",
      "release/**",
      "vite.base.config.ts",
      "vite.main.config.ts",
      "vite.preload.config.ts",
      "forge.config.ts",
      "forge.env.d.ts",
    ],
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { maxWarnings: 0 },
  },
});
