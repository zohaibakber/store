import {
  stageUsesInventoryPostgres,
  stageUsesNeonInventory,
  stageUsesPlanetscaleInventory,
} from "@store/db/postgres/stage";
import { describe, expect, it } from "vitest";

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
});
