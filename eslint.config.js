//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    // Vendored shadcn/ui components (and the theme-provider/mode-toggle from
    // the shadcn docs) are added verbatim. Relax type-aware/style rules that
    // don't apply to this upstream code.
    files: ["src/components/**", "src/hooks/**"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-shadow": "off",
    },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc"],
  },
]
