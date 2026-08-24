import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const requireText = (text, expected, label) => {
  if (!text.includes(expected)) throw new Error(`${label} is missing ${expected}.`);
};

const sourceFiles = (directory) => {
  const absolute = new URL(directory, root).pathname;
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return sourceFiles(`${directory}${name}/`);
    return /\.[cm]?[jt]sx?$/u.test(name) ? [path] : [];
  });
};

const runtimeSource = [
  ...sourceFiles("apps/web/src/"),
  ...sourceFiles("apps/mobile/src/"),
  ...sourceFiles("apps/server/src/"),
  ...sourceFiles("packages/client-db/src/"),
].map((path) => readFileSync(path, "utf8"));

for (const forbidden of ["@electric-sql/client", "@tanstack/electric-db-collection"]) {
  if (runtimeSource.some((source) => source.includes(forbidden))) {
    throw new Error(`Runtime source still imports ${forbidden}.`);
  }
}

const syncConfig = read("powersync/sync-config.yaml");
for (const table of [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
]) {
  requireText(syncConfig, `FROM ${table}`, "PowerSync sync config");
}
requireText(syncConfig, "auth.parameter('org')", "PowerSync organization isolation");

const server = read("apps/server/src/http/app.ts");
requireText(server, '"/api/powersync/credentials"', "server credential route");
requireText(
  read("apps/server/src/http/api.ts"),
  '"/api/inventory/legacy-migrations"',
  "legacy desktop migration route",
);
requireText(
  read("apps/desktop/electron/legacy-local-inventory.ts"),
  'path.join(userDataPath, "organizations")',
  "legacy signed-in database discovery",
);
requireText(
  read("apps/web/src/lib/inventory-db.tsx"),
  "await migrateLegacyCatalog({",
  "desktop migration gate",
);
requireText(
  read("packages/client-db/src/legacy-catalog.ts"),
  "export const migrateLegacyCatalog",
  "legacy catalog migration helper",
);
requireText(read("apps/auth/src/http.ts"), '"/.well-known/jwks.json"', "auth JWKS route");
requireText(read(".github/workflows/infra.yml"), "POWERSYNC_URL", "deployment workflow");

console.log("PowerSync migration invariants are present.");
