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
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

const dependencyNames = (manifestPath: string) => {
  const manifest: unknown = JSON.parse(readRepo(manifestPath));
  if (!isRecord(manifest)) {
    throw new Error(`${manifestPath} is not a JSON object.`);
  }
  return dependencyFields.flatMap((field) => {
    const value = manifest[field];
    if (!isRecord(value)) return [];
    return Object.keys(value);
  });
};

describe("retired Clerk and Electric config", () => {
  it("keeps Clerk and Electric client packages out of workspace manifests", () => {
    for (const manifestPath of packageManifests) {
      const names = dependencyNames(manifestPath);
      expect(names.filter((name) => name.startsWith("@clerk/"))).toEqual([]);
      expect(names.filter((name) => forbiddenPackages.includes(name))).toEqual([]);
    }
  });

  it("keeps CLERK_ and ELECTRIC_ out of toolchain, CI, and env tables", () => {
    for (const path of configFiles) {
      const text = readRepo(path);
      expect(text.match(leftoverEnvName)).toBeNull();
      for (const forbidden of [...forbiddenPackages, "@clerk/"]) {
        expect(text.includes(forbidden)).toBe(false);
      }
    }
  });
});
