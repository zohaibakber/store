import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bundles = [
  { name: "inventory", migrations: "migrations/inventory", out: "src/inventory/migrations.gen.ts" },
  { name: "replica", migrations: "migrations/replica", out: "src/replica/migrations.gen.ts" },
];

const readMigrations = (directory) => {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return entries.map((entry) => ({
    key: entry,
    sql: readFileSync(join(directory, entry, "migration.sql"), "utf8"),
  }));
};

const renderBundle = (name, migrations) => {
  const identifier = `${name}Migrations`;
  const entries = migrations
    .map(({ key, sql }) => `  ${JSON.stringify(key)}: ${JSON.stringify(sql)},`)
    .join("\n");
  return `export const ${identifier}: Record<string, string> = {\n${entries}\n};\n`;
};

let drifted = false;

for (const bundle of bundles) {
  const directory = join(packageRoot, bundle.migrations);
  const target = join(packageRoot, bundle.out);
  const rendered = renderBundle(bundle.name, readMigrations(directory));
  let current = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = null;
  }
  if (current === rendered) continue;
  drifted = true;
  if (process.argv.includes("--check")) {
    process.stderr.write(`${bundle.out} is out of date. Run pnpm --filter @store/db db:bundle.\n`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rendered);
  process.stdout.write(`wrote ${bundle.out}\n`);
}

if (drifted && process.argv.includes("--check")) process.exit(1);
