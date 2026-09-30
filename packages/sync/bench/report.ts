import * as Schema from "effect/Schema";

import { MemoryPeak, Summary } from "./stats";

const Footprint = Schema.Struct({
  dbBytes: Schema.Number,
  walBytes: Schema.Number,
  shmBytes: Schema.Number,
});

export const ScenarioExtra = Schema.Record(
  Schema.String,
  Schema.Union([Schema.Boolean, Schema.Number, Schema.String]),
);
export type ScenarioExtra = typeof ScenarioExtra.Type;

export const ResultRecord = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  size: Schema.String,
  status: Schema.String,
  exitStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  signal: Schema.optional(Schema.NullOr(Schema.String)),
  reps: Schema.optional(Schema.Struct({ warmup: Schema.Number, measured: Schema.Number })),
  latencyMs: Schema.optional(Summary),
  phasesMs: Schema.optional(Schema.Record(Schema.String, Summary)),
  rows: Schema.optional(Summary),
  cpuMsPerRep: Schema.optional(Schema.Number),
  memory: Schema.optional(MemoryPeak),
  database: Schema.optional(Footprint),
  databaseAfterClose: Schema.optional(Footprint),
  extra: Schema.optional(ScenarioExtra),
  wallSeconds: Schema.optional(Schema.Number),
  note: Schema.optional(Schema.String),
});
export type ResultRecord = typeof ResultRecord.Type;

const BenchEnvironment = Schema.Struct({
  node: Schema.String,
  cpu: Schema.optional(Schema.String),
  cores: Schema.Number,
  memoryGiB: Schema.Number,
  platform: Schema.String,
  sizes: Schema.Record(Schema.String, Schema.Number),
});

export const ReportDocument = Schema.Struct({
  tree: Schema.String,
  generatedAt: Schema.String,
  environment: BenchEnvironment,
  fixtures: Schema.Array(Schema.Json),
  results: Schema.Array(ResultRecord),
});
export type ReportDocument = typeof ReportDocument.Type;

const fixed = (value: number, digits = 1): string =>
  value >= 1000 ? value.toFixed(0) : value.toFixed(digits);

const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

const row = (record: ResultRecord): string => {
  if (record.status !== "ok" || !record.latencyMs || !record.reps || !record.memory) {
    return `${record.id} | ${record.size} | FAILED (exit ${record.exitStatus ?? "?"}, signal ${record.signal ?? "none"}) | - | - | - | - | - | - | - | - | -`;
  }
  const { latencyMs, memory, database } = record;
  return [
    record.id,
    record.size,
    String(record.reps.measured),
    fixed(latencyMs.p50),
    fixed(latencyMs.p95),
    fixed(latencyMs.p99),
    fixed(latencyMs.max),
    record.rows ? fixed(record.rows.mean, 0) : "-",
    fixed(memory.rssMaxMiB, 0),
    fixed(memory.heapUsedPeakMiB, 0),
    database ? mib(database.dbBytes) : "-",
    mib(memory.walPeakMiB * 1024 * 1024),
  ].join(" | ");
};

export const renderReport = (document: ReportDocument): string => {
  const lines = [
    `# Sync replica benchmark: ${document.tree}`,
    "",
    `Generated ${document.generatedAt}. In-process node:sqlite replica (the desktop worker store). Latencies in milliseconds; nearest-rank percentiles over warm repetitions.`,
    "",
    "| scenario | size | reps | p50 | p95 | p99 | max | rows | RSS peak MiB | heap peak MiB | DB MiB | WAL peak MiB |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...document.results.map((record) => `| ${row(record)} |`),
  ];
  const noted = document.results.filter((record) => record.note !== undefined);
  if (noted.length > 0) {
    lines.push("", "## Notes", "");
    for (const record of noted) lines.push(`- ${record.id} (${record.size}): ${record.note}`);
  }
  const phased = document.results.filter(
    (record) => record.phasesMs && Object.keys(record.phasesMs).length > 0,
  );
  if (phased.length > 0) {
    lines.push(
      "",
      "## Phases",
      "",
      "| scenario | size | phase | p50 | max |",
      "|---|---|---|---|---|",
    );
    for (const record of phased) {
      for (const [phase, summary] of Object.entries(record.phasesMs ?? {})) {
        lines.push(
          `| ${record.id} | ${record.size} | ${phase} | ${fixed(summary.p50)} | ${fixed(summary.max)} |`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
};
