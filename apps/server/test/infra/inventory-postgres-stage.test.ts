import { readFileSync } from "node:fs";

import { stageUsesInventoryPostgres } from "@store/db/postgres/stage";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;
const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

describe("inventory Postgres stage", () => {
  it("skips Neon on nightly and keeps it on live stages", () => {
    expect(stageUsesInventoryPostgres("nightly")).toBe(false);
    expect(stageUsesInventoryPostgres("prod")).toBe(true);
    expect(stageUsesInventoryPostgres("dev")).toBe(true);
  });

  it("does not load Neon providers or yield a project on nightly", () => {
    const stack = readRepo("alchemy.run.ts");
    expect(stack).toContain("stageUsesInventoryPostgres");
    expect(stack).toContain("Neon.providers()");
    expect(stack).toContain("Layer.empty");
    expect(stack).toContain("if (!stageUsesInventoryPostgres(stage))");
  });

  it("does not require Neon for nightly CI", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci).toContain('STAGE}" != "nightly"');
    expect(ci).toContain("NEON_API_KEY");
    expect(ci).not.toContain("POWERSYNC_URL");
    expect(ci).toContain("Nightly PRODUCTION_DOMAIN must not be the production hostname.");
  });
});
