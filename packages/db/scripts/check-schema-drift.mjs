import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(packageRoot, "scripts", "drizzle-kit.cjs");

const targets = [
  { config: "drizzle.auth.config.ts", dialect: "sqlite" },
  { config: "drizzle.postgres.config.ts", dialect: "postgresql" },
  { config: "drizzle.replica.config.ts", dialect: "sqlite" },
  { config: "drizzle.analytics.config.ts", dialect: "sqlite" },
];

const describeStatements = (statements) =>
  Array.isArray(statements)
    ? statements
        .map((statement) => {
          const table = statement?.column?.table ?? statement?.table?.name ?? statement?.name;
          return table === undefined ? String(statement?.type) : `${statement?.type} ${table}`;
        })
        .join(", ")
    : "unknown";

const inspect = ({ config, dialect }) => {
  const result = spawnSync(
    process.execPath,
    [wrapper, "generate", "--config", config, "--explain", "--output", "json"],
    { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );
  if (result.error) return `could not run drizzle-kit: ${result.error.message}`;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim().split("\n").slice(-5).join(" | ");
    return `drizzle-kit exited with ${result.status ?? result.signal}: ${detail}`;
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return `output is not valid JSON: ${result.stdout.trim().slice(0, 200)}`;
  }
  if (report?.dialect !== dialect) {
    return `expected dialect ${dialect}, got ${String(report?.dialect)}`;
  }
  if (report?.status === "no_changes") {
    return Array.isArray(report.hints) && report.hints.length > 0
      ? `unresolved hints: ${JSON.stringify(report.hints)}`
      : null;
  }
  if (report?.status === "ok") {
    return `schema differs from the latest snapshot, a migration is pending (${describeStatements(report.statements)})`;
  }
  return `unexpected status ${String(report?.status)}`;
};

const failures = [];
for (const target of targets) {
  const reason = inspect(target);
  if (reason === null) {
    console.log(`schema drift: ${target.config} ok`);
  } else {
    failures.push(`${target.config}: ${reason}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`schema drift: ${failure}`);
  process.exit(1);
}
