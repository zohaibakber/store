import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      ".repos/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/src/routeTree.gen.ts",
      "**/worker-configuration.d.ts",
    ],
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 15_000,
  },
  lint: {
    ignorePatterns: [
      ".repos/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/src/routeTree.gen.ts",
      "**/worker-configuration.d.ts",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
