import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAINTENANCE_POLICY } from "../../src/inventory/maintenance";

const repoRoot = new URL("../../../../", import.meta.url).pathname;
const infraSource = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");

describe("inventory maintenance cron trigger", () => {
  it("declares the cron trigger on the API Worker through Alchemy", () => {
    expect(infraSource).toContain("Cloudflare.Workers.cron(MAINTENANCE_POLICY.cronExpression");
    expect(infraSource).toContain("Effect.provide(Cloudflare.Workers.CronEventSourceLive)");
    expect(infraSource).not.toContain("wrangler.jsonc");
    expect(infraSource).not.toContain("crons:");
  });

  it("skips the scheduled handler for stages without inventory Postgres", () => {
    const guarded = infraSource.slice(
      infraSource.indexOf("if (stageUsesInventoryPostgres(stage)) {"),
      infraSource.indexOf("const syncAuthority"),
    );
    expect(guarded).toContain("Cloudflare.Workers.cron");
    expect(guarded).toContain("inventory.maintenance");
  });

  it("uses a five field cron expression and a bounded run budget", () => {
    expect(MAINTENANCE_POLICY.cronExpression.split(" ")).toHaveLength(5);
    expect(MAINTENANCE_POLICY.budgetMillis).toBeLessThanOrEqual(25_000);
    expect(MAINTENANCE_POLICY.organizationsPerRun).toBeGreaterThan(0);
  });
});
