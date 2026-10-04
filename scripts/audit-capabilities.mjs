import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const detailed = process.argv.includes("--details");
if (process.argv.slice(2).some((arg) => arg !== "--details")) {
  throw new Error("Usage: node scripts/audit-capabilities.mjs [--details]");
}

const rules = [
  [
    "durable-objects",
    /Cloudflare\.DurableObject|DurableObjectState|getByName|setWebSocketAutoResponse|serializeAttachment/,
  ],
  [
    "effect-runtime-edges",
    /ManagedRuntime\.make|Effect\.run(?:Promise|Fork|Sync)|Fiber(?:Map|Set)\.makeRuntime/,
  ],
  [
    "effect-durable-work",
    /["']effect\/(?:workflow|cluster|eventlog)\b|DurableQueue|PersistedQueue/,
  ],
  ["ai-integrations", /LanguageModel|GenerateModelJson|ModelPrompt/],
  ["drizzle-effect-adapters", /["']drizzle-orm\/(?:effect|[^"']*effect)|EffectSQLite|EffectPg/],
  ["sql-adapters", /SQLiteSession|PgSession|PgDialect|SQLiteSyncDialect|sqlToQuery|\.unsafe\(/],
  [
    "command-and-transaction-ordering",
    /Semaphore\.make|withPermits|withTransaction|CommandAdmission/,
  ],
  ["compatibility-patches", /effect\/unstable|patchedDependencies|patches\//],
];

const files = git("ls-files", "--", "apps", "packages", "patches", "pnpm-workspace.yaml")
  .split("\n")
  .filter((file) => /\.(?:ts|tsx|mjs|cjs|patch|yaml)$/.test(file))
  .filter((file) => !file.includes("/migrations/") && !file.endsWith(".gen.ts"))
  .sort();
const contents = files.map((file) => ({
  file,
  lines: readFileSync(resolve(root, file), "utf8").split("\n"),
}));
const groups = rules.map(([name, pattern]) => {
  const matches = contents.flatMap(({ file, lines }) =>
    lines.flatMap((line, index) =>
      pattern.test(line)
        ? [{ file, line: index + 1, text: line.trim(), test: /\/test\//.test(file) }]
        : [],
    ),
  );
  const summary = {
    name,
    sourceFiles: new Set(matches.filter((match) => !match.test).map((match) => match.file)).size,
    testFiles: new Set(matches.filter((match) => match.test).map((match) => match.file)).size,
    matchedLines: matches.length,
  };
  return detailed ? { ...summary, matches } : summary;
});

console.log(
  JSON.stringify(
    {
      revision: git("rev-parse", "HEAD"),
      scope: "Tracked source, configuration and patches; excludes generated files and migrations.",
      evidenceOnly:
        "Matches locate code for review. Counts do not establish misuse or correctness.",
      filesScanned: files.length,
      groups,
    },
    null,
    2,
  ),
);
