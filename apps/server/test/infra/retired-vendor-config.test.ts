import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;

const packageManifests = [
  "package.json",
  "apps/auth/package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/auth/package.json",
  "packages/client-db/package.json",
  "packages/contracts/package.json",
  "packages/db/package.json",
  "packages/services/package.json",
  "packages/workspace/package.json",
];

const configFiles = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "alchemy.run.ts",
  "stacks/github.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/infra.yml",
  ".github/workflows/release.yml",
  ".github/workflows/android.yml",
  "README.md",
  "apps/server/README.md",
  "apps/web/README.md",
  "packages/README.md",
  "docs/sync/postgres-powersync-migration.md",
  "docs/sync/websocket-engine.md",
];

const forbiddenPackages = [
  "@electric-sql/client",
  "@electric-sql/react",
  "@tanstack/electric-db-collection",
];
const leftoverEnvName = /\b(?:CLERK_|ELECTRIC_|VITE_CLERK|EXPO_PUBLIC_CLERK)[A-Z0-9_]*/u;

const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

describe("retired Clerk and Electric config", () => {
  it("keeps Clerk and Electric client packages out of workspace manifests", () => {
    for (const manifestPath of packageManifests) {
      const text = readRepo(manifestPath);
      expect(text.includes('"@clerk/')).toBe(false);
      for (const forbidden of forbiddenPackages) {
        expect(text.includes(`"${forbidden}"`)).toBe(false);
      }
    }
  });

  it("keeps CLERK_ and ELECTRIC_ out of toolchain, CI, and env tables", () => {
    for (const path of configFiles) {
      const text = readRepo(path);
      expect(text.match(leftoverEnvName)).toBeNull();
      expect(text.includes("@clerk/")).toBe(false);
      for (const forbidden of forbiddenPackages) {
        expect(text.includes(forbidden)).toBe(false);
      }
    }
  });
});
