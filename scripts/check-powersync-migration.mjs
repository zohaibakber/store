import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const requireText = (text, expected, label) => {
  if (!text.includes(expected)) throw new Error(`${label} is missing ${expected}.`);
};
const forbidText = (text, forbidden, label) => {
  if (text.includes(forbidden)) throw new Error(`${label} still contains ${forbidden}.`);
};

const sourceFiles = (directory) => {
  const absolute = new URL(directory, root).pathname;
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return sourceFiles(`${directory}${name}/`);
    return /\.[cm]?[jt]sx?$/u.test(name) ? [path] : [];
  });
};

const packageManifests = [
  "package.json",
  "apps/auth/package.json",
  "apps/desktop/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/auth/package.json",
  "packages/client-db/package.json",
  "packages/contracts/package.json",
  "packages/db/package.json",
  "packages/services/package.json",
  "packages/workspace/package.json",
];

const configTexts = [
  ["pnpm-workspace.yaml", read("pnpm-workspace.yaml")],
  ["turbo.json", read("turbo.json")],
  ["alchemy.run.ts", read("alchemy.run.ts")],
  ["stacks/github.ts", read("stacks/github.ts")],
  [".github/workflows/ci.yml", read(".github/workflows/ci.yml")],
  [".github/workflows/infra.yml", read(".github/workflows/infra.yml")],
  [".github/workflows/release.yml", read(".github/workflows/release.yml")],
  [".github/workflows/android.yml", read(".github/workflows/android.yml")],
  ["README.md", read("README.md")],
  ["apps/server/README.md", read("apps/server/README.md")],
  ["apps/web/README.md", read("apps/web/README.md")],
  ["packages/README.md", read("packages/README.md")],
];

const forbiddenPackages = [
  "@electric-sql/client",
  "@electric-sql/react",
  "@tanstack/electric-db-collection",
];
const forbiddenPackagePrefix = "@clerk/";
const leftoverEnvName = /\b(?:CLERK_|ELECTRIC_|VITE_CLERK|EXPO_PUBLIC_CLERK)[A-Z0-9_]*/u;
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const runtimeSource = [
  ...sourceFiles("apps/web/src/"),
  ...sourceFiles("apps/server/src/"),
  ...sourceFiles("packages/client-db/src/"),
].map((path) => readFileSync(path, "utf8"));

for (const forbidden of [...forbiddenPackages, forbiddenPackagePrefix]) {
  if (runtimeSource.some((source) => source.includes(forbidden))) {
    throw new Error(`Runtime source still imports ${forbidden}.`);
  }
}

for (const manifestPath of packageManifests) {
  const manifest = JSON.parse(read(manifestPath));
  const names = dependencyFields.flatMap((field) => Object.keys(manifest[field] ?? {}));
  const leftover = names.find(
    (name) => name.startsWith(forbiddenPackagePrefix) || forbiddenPackages.includes(name),
  );
  if (leftover) {
    throw new Error(`${manifestPath} still depends on ${leftover}.`);
  }
}

for (const [label, text] of configTexts) {
  const match = leftoverEnvName.exec(text);
  if (match) {
    throw new Error(`${label} still names ${match[0]}.`);
  }
  for (const forbidden of [...forbiddenPackages, forbiddenPackagePrefix]) {
    if (text.includes(forbidden)) {
      throw new Error(`${label} still mentions ${forbidden}.`);
    }
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
forbidText(read("apps/server/src/http/api.ts"), '"/api/inventory/legacy-migrations"', "server API");
forbidText(read("apps/server/infra.ts"), "LegacyMigrationQueue", "API infra");
forbidText(read("apps/web/src/lib/inventory-db.tsx"), "migrateLegacyCatalog", "inventory database");
requireText(read("apps/auth/src/http.ts"), '"/.well-known/jwks.json"', "auth JWKS route");
requireText(read(".github/workflows/infra.yml"), "POWERSYNC_URL", "deployment workflow");

console.log("PowerSync migration invariants are present.");
