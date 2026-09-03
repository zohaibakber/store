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
  "packages/sync/package.json",
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
  "@powersync/common",
  "@powersync/web",
  "@journeyapps/wa-sqlite",
  "@tanstack/powersync-db-collection",
];
const forbiddenPackagePrefix = "@clerk/";
const leftoverEnvName = /\b(?:CLERK_|ELECTRIC_|VITE_CLERK|EXPO_PUBLIC_CLERK|POWERSYNC_)[A-Z0-9_]*/u;
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
  ...sourceFiles("packages/sync/src/"),
].map((path) => readFileSync(path, "utf8"));

for (const forbidden of [
  ...forbiddenPackages,
  forbiddenPackagePrefix,
  "wa-sqlite",
  "PowerSyncDatabase",
  "powerSyncCollectionOptions",
]) {
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

const serverApi = read("apps/server/src/http/api.ts");
requireText(serverApi, '"/api/inventory/pull"', "catalog pull");
requireText(serverApi, '"/api/inventory/snapshot"', "catalog snapshot");
forbidText(serverApi, '"/api/inventory/legacy-migrations"', "server API");
forbidText(read("apps/server/src/http/app.ts"), "/api/powersync/credentials", "server app");
forbidText(read("apps/server/infra.ts"), "LegacyMigrationQueue", "API infra");
forbidText(read("apps/server/infra.ts"), "POWERSYNC_URL", "API infra");
requireText(read("packages/db/src/postgres/schema.ts"), "catalog_change_log", "change log table");
requireText(read("packages/sync/src/indexed-db.ts"), "indexedDB", "IndexedDB adapter");
forbidText(read("packages/sync/src/engine.ts"), "wa-sqlite", "catalog engine");
requireText(read("apps/auth/src/http.ts"), '"/.well-known/jwks.json"', "auth JWKS route");

console.log("Catalog replica invariants are present.");
