import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

export default defineConfig({
  root: here,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(here, "wrangler.jsonc") },
    }),
  ],
  resolve: {
    alias: {
      "@store/db/inventory/migrations": path.join(
        repo,
        "packages/db/src/inventory/migrations.gen.ts",
      ),
      "@store/db/inventory.schema": path.join(repo, "packages/db/src/inventory/schema.ts"),
      "@store/contracts/sync/fixtures": path.join(
        repo,
        "packages/contracts/src/sync/fixtures/last-unit-invoice.ts",
      ),
      "@store/contracts/operation-hash": path.join(
        repo,
        "packages/contracts/src/sync/operation-hash.ts",
      ),
      "@store/contracts/ids": path.join(repo, "packages/contracts/src/ids.ts"),
      "@store/sync/authority/seed": path.join(repo, "packages/sync/src/authority/seed.ts"),
      "@store/sync/authority": path.join(repo, "packages/sync/src/authority/commands.ts"),
      "@store/sync/migrations": path.join(repo, "packages/sync/src/migrations.ts"),
      "@store/sync/sqlite": path.join(repo, "packages/sync/src/sqlite.ts"),
      "@store/contracts": path.join(repo, "packages/contracts/src/index.ts"),
    },
  },
  test: {
    include: ["proofs.test.ts"],
    testTimeout: 30_000,
  },
});
