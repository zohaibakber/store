import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/src/routeTree.gen.ts",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
