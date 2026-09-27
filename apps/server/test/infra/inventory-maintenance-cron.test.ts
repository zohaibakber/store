import { describe, expect, it } from "vitest";

import { MAINTENANCE_POLICY } from "../../src/inventory/maintenance";

describe("inventory maintenance cron trigger", () => {
  it("uses a five field cron expression and a bounded run budget", () => {
    expect(MAINTENANCE_POLICY.cronExpression.split(" ")).toHaveLength(5);
    expect(MAINTENANCE_POLICY.budgetMillis).toBeLessThanOrEqual(25_000);
    expect(MAINTENANCE_POLICY.organizationsPerRun).toBeGreaterThan(0);
  });
});
