import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

const ForbiddenRendererMarkers = Schema.Array(Schema.String);

const require = createRequire(import.meta.url);
const afterPack = require("../../scripts/verify-after-pack.cjs");
const forbiddenRendererMarkers = Schema.decodeUnknownSync(ForbiddenRendererMarkers)(
  afterPack.forbiddenRendererMarkers,
);

const forbiddenRendererReplicaSqlMarkers = Schema.decodeUnknownSync(ForbiddenRendererMarkers)(
  afterPack.forbiddenRendererReplicaSqlMarkers,
);

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const replicaSql = readFileSync(
  path.join(repoRoot, "packages/db/src/replica/migrations.gen.ts"),
  "utf8",
);
const subsetLowering = readFileSync(
  path.join(repoRoot, "packages/client-db/src/replica/compile.ts"),
  "utf8",
);
const inventorySql = readFileSync(
  path.join(repoRoot, "scripts/migrate-cloudflare/src/authority-migrations.gen.ts"),
  "utf8",
);

const authoritySqlMarkers = forbiddenRendererMarkers.filter(
  (marker) =>
    marker !== "drizzle-orm" &&
    marker !== "invoice_counters" &&
    marker !== "wa-sqlite" &&
    marker !== "sql-sqlite-wasm" &&
    marker !== "OpfsWorker",
);

describe("desktop renderer schema boundary", () => {
  it("keeps replica SQL out of the renderer ban list", () => {
    expect(replicaSql).toContain("invoices_organization_id_invoice_number_uidx");
    expect(replicaSql).toContain("categories_organization_id_name_uidx");
    expect(replicaSql).toContain("products_organization_id_category_id_idx");
    for (const marker of forbiddenRendererMarkers) {
      expect(replicaSql.includes(marker)).toBe(false);
    }
  });

  it("still flags inventory-authority SQL that must not ship in the renderer", () => {
    expect(authoritySqlMarkers.length).toBeGreaterThan(0);
    for (const marker of authoritySqlMarkers) {
      expect(inventorySql).toContain(marker);
    }
  });

  it("bans the worker-side subset SQL lowering from the renderer", () => {
    expect(forbiddenRendererReplicaSqlMarkers.length).toBeGreaterThan(0);
    for (const marker of forbiddenRendererReplicaSqlMarkers) {
      expect(subsetLowering).toContain(marker);
    }
  });
});
