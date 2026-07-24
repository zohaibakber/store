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
    sortImports: true,
    sortTailwindcss: {
      functions: ["clsx", "cn", "cva", "twMerge"],
      stylesheet: "./apps/desktop/src/styles.css",
    },
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
    overrides: [
      {
        files: ["apps/desktop/src/**/*.{ts,tsx}"],
        plugins: ["react"],
        rules: {
          "react/no-children-prop": "off",
          "react/react-compiler": "error",
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
