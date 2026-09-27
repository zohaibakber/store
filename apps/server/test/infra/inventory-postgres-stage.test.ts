import { readFileSync } from "node:fs";

import {
  stageUsesInventoryPostgres,
  stageUsesNeonInventory,
  stageUsesPlanetscaleInventory,
} from "@store/db/postgres/stage";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;
const readRepo = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

describe("inventory Postgres stage", () => {
  it("skips inventory Postgres on nightly and keeps it on live stages", () => {
    expect(stageUsesInventoryPostgres("nightly")).toBe(false);
    expect(stageUsesInventoryPostgres("prod")).toBe(true);
    expect(stageUsesInventoryPostgres("dev")).toBe(true);
  });

  it("runs dev on Neon and every other Postgres stage on PlanetScale", () => {
    expect(stageUsesNeonInventory("dev")).toBe(true);
    expect(stageUsesPlanetscaleInventory("dev")).toBe(false);
    expect(stageUsesPlanetscaleInventory("prod")).toBe(true);
    expect(stageUsesNeonInventory("prod")).toBe(false);
    expect(stageUsesNeonInventory("nightly")).toBe(false);
    expect(stageUsesPlanetscaleInventory("nightly")).toBe(false);
  });

  it("loads each Postgres provider only on its own stages and none on nightly", () => {
    const stack = readRepo("alchemy.run.ts");
    expect(stack).toContain("stageUsesInventoryPostgres");
    expect(stack).toContain("Planetscale.providers()");
    expect(stack).toContain("Layer.empty");
    expect(stack).toContain("if (!stageUsesInventoryPostgres(stage))");
    expect(stack).toContain("stageUsesNeonInventory(stage)");
    expect(stack).toContain("Neon.providers()");
  });

  it("does not require PlanetScale credentials for nightly CI", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci).toContain('STAGE}" != "nightly"');
    expect(ci).toContain("PLANETSCALE_API_TOKEN");
    expect(ci).not.toContain("NEON_API_KEY");
    expect(ci).not.toContain("POWERSYNC_URL");
    expect(ci).toContain("Nightly PRODUCTION_DOMAIN must not be the production hostname.");
  });
});
