import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Clerk leftovers only. Electric / PowerSync leftover scanning lives in
 * `scripts/check-powersync-migration.mjs` (run by `vp check`).
 */
const repoRoot = new URL("../../../../", import.meta.url).pathname;
const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

describe("retired Clerk config", () => {
  it("keeps @clerk out of auth and desktop manifests", () => {
    expect(readRepo("apps/auth/package.json").includes('"@clerk/')).toBe(false);
    expect(readRepo("apps/desktop/package.json").includes('"@clerk/')).toBe(false);
    expect(readRepo("packages/auth/package.json").includes('"@clerk/')).toBe(false);
  });
});
