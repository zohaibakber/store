import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Clerk leftovers only. Electric / PowerSync leftover scanning lives in
 * `scripts/check-powersync-migration.mjs` (run by `vp check`).
 */
const repoRoot = new URL("../../../../", import.meta.url).pathname;
const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

describe("retired Clerk config", () => {
  it("keeps @clerk out of auth and web manifests", () => {
    expect(readRepo("apps/auth/package.json").includes('"@clerk/')).toBe(false);
    expect(readRepo("apps/web/package.json").includes('"@clerk/')).toBe(false);
    expect(readRepo("packages/auth/package.json").includes('"@clerk/')).toBe(false);
  });
});
