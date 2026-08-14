import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  fmt: {
    ignorePatterns: [
      ".repos/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/src/routeTree.gen.ts",
      "**/worker-configuration.d.ts",
      "packages/db/src/do/migrations.ts",
      "packages/db/src/local/migrations.ts",
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
    include: ["apps/*/test/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.ts"],
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
      "packages/db/src/do/migrations.ts",
      "packages/db/src/local/migrations.ts",
    ],
    overrides: [
      {
        files: ["apps/desktop/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
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
