import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import * as Schema from "effect/Schema";

import { openBenchReplica } from "./adapter";
import {
  databaseFootprint,
  ensureFixture,
  removeDatabase,
  SIZES,
  workCopy,
  type SizeLabel,
} from "./fixture";
import { renderReport, ReportDocument, ResultRecord } from "./report";
import { SCENARIOS } from "./scenarios";
import { startMemorySampler, summarize } from "./stats";

const HEAVY_LOCK = "/tmp/store-heavy.lock";
const CHILD_HEAP_MIB = 2048;

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const log = (message: string) => {
  process.stderr.write(`[bench ${new Date().toISOString().slice(11, 19)}] ${message}\n`);
};

const isSize = (value: string): value is SizeLabel => value === "10k" || value === "100k";

const runChild = async () => {
  const [, , command, label, scenarioId, dbPath, outPath] = process.argv;
  if (command !== "child" || !label || !isSize(label) || !scenarioId || !dbPath || !outPath) {
    throw new Error("Invalid child invocation.");
  }
  const scenario = SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}.`);
  const fixture = await ensureFixture(label);
  const overrideReps = arg("reps");
  const planned = scenario.reps(label);
  const measured = overrideReps ? Number(overrideReps) : planned.measured;
  const warmup = overrideReps ? Math.min(planned.warmup, 3) : planned.warmup;
  const started = performance.now();
  scenario.prepare?.(dbPath, fixture.counts);
  const replica = await openBenchReplica(dbPath);
  if (!process.argv.includes("--no-optimize")) {
    const optimizeStarted = performance.now();
    const optimized = await replica.optimizePlanner();
    log(
      `planner maintenance ${optimized} in ${Math.round(performance.now() - optimizeStarted)} ms`,
    );
  }
  const context = { replica, counts: fixture.counts, label, log };
  const runner = await scenario.start(context);
  globalThis.gc?.();
  const sampler = startMemorySampler(dbPath);
  const cpuStart = process.cpuUsage();
  const latencies: Array<number> = [];
  const rowCounts: Array<number> = [];
  const phases = new Map<string, Array<number>>();
  for (let index = 0; index < warmup + measured; index += 1) {
    const before = performance.now();
    const iteration = await runner.run(index);
    const elapsed = performance.now() - before;
    sampler.sample();
    if (index < warmup) continue;
    latencies.push(elapsed);
    if (iteration.rows !== undefined) rowCounts.push(iteration.rows);
    for (const [name, value] of Object.entries(iteration.phases ?? {})) {
      phases.set(name, [...(phases.get(name) ?? []), value]);
    }
  }
  const cpu = process.cpuUsage(cpuStart);
  const memory = sampler.stop();
  const footprint = databaseFootprint(dbPath);
  await replica.close();
  const closed = databaseFootprint(dbPath);
  const result = {
    id: scenario.id,
    title: scenario.title,
    size: label,
    status: "ok",
    reps: { warmup, measured },
    latencyMs: summarize(latencies),
    phasesMs: Object.fromEntries([...phases].map(([name, values]) => [name, summarize(values)])),
    rows: rowCounts.length === 0 ? undefined : summarize(rowCounts),
    cpuMsPerRep: (cpu.user + cpu.system) / 1000 / Math.max(1, warmup + measured),
    memory,
    database: footprint,
    databaseAfterClose: closed,
    extra: runner.extra?.() ?? {},
    wallSeconds: (performance.now() - started) / 1000,
  } satisfies ResultRecord;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
};

const capped = (args: ReadonlyArray<string>) =>
  spawnSync(
    "flock",
    [
      HEAVY_LOCK,
      "systemd-run",
      "--user",
      "--scope",
      "-q",
      "-p",
      "MemoryMax=3G",
      "-p",
      "MemorySwapMax=0",
      ...args,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

const selfCommand = (...rest: ReadonlyArray<string>) => [
  process.execPath,
  `--max-old-space-size=${CHILD_HEAP_MIB}`,
  "--expose-gc",
  ...process.execArgv,
  ...process.argv.slice(1, 2),
  ...rest,
];

const decodeResult = Schema.decodeSync(Schema.fromJsonString(ResultRecord));
const decodeDocument = Schema.decodeSync(Schema.fromJsonString(ReportDocument));
const decodeNotes = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

const orchestrate = async () => {
  const sizes = (arg("size") ?? "10k").split(",").filter(isSize);
  const only = arg("only")?.split(",");
  const out = arg("out") ?? "/tmp/store-bench-results";
  const tree = arg("tree") ?? "working tree";
  const reps = arg("reps");
  mkdirSync(out, { recursive: true });
  const results: Array<ResultRecord> = [];
  const fixtures: Array<Schema.Json> = [];
  for (const label of sizes) {
    const generation = capped(selfCommand("fixture", label));
    if (generation.status !== 0) throw new Error(`Fixture generation failed for ${label}.`);
    const fixture = await ensureFixture(label);
    fixtures.push({ ...fixture.manifest, path: fixture.path });
    const shared = workCopy(fixture, "read");
    for (const scenario of SCENARIOS) {
      if (only && !only.includes(scenario.id)) continue;
      const outPath = join(out, `${label}-${scenario.id}.json`);
      rmSync(outPath, { force: true });
      const dbPath = scenario.mutates ? workCopy(fixture, scenario.id) : shared;
      log(`${label} ${scenario.id}`);
      const started = performance.now();
      const child = capped(
        selfCommand(
          "child",
          label,
          scenario.id,
          dbPath,
          outPath,
          ...(reps ? ["--reps", reps] : []),
          ...(process.argv.includes("--no-optimize") ? ["--no-optimize"] : []),
        ),
      );
      if (scenario.mutates) removeDatabase(dbPath);
      let record: ResultRecord;
      try {
        record = decodeResult(readFileSync(outPath, "utf8"));
      } catch {
        record = {
          id: scenario.id,
          title: scenario.title,
          size: label,
          status: "failed",
          exitStatus: child.status,
          signal: child.signal,
          wallSeconds: (performance.now() - started) / 1000,
        };
      }
      results.push(record);
      writeFileSync(join(out, "partial.json"), JSON.stringify({ results }, null, 2));
    }
    removeDatabase(shared);
  }
  const document: ReportDocument = {
    tree,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGiB: totalmem() / 1024 ** 3,
      platform: process.platform,
      sizes: Object.fromEntries(sizes.map((size) => [size, SIZES[size]])),
    },
    fixtures,
    results,
  };
  const jsonPath = join(out, "results.json");
  writeFileSync(jsonPath, JSON.stringify(document, null, 2));
  writeFileSync(join(out, "results.md"), renderReport(document));
  log(`wrote ${jsonPath}`);
};

const merge = () => {
  const out = arg("out") ?? "/tmp/store-bench-results";
  const tree = arg("tree") ?? "working tree";
  const inputs = (arg("from") ?? "").split(",").filter((entry) => entry !== "");
  const documents = inputs.map((dir) =>
    decodeDocument(readFileSync(join(dir, "results.json"), "utf8")),
  );
  const notes = decodeNotes(arg("notes") ?? "{}");
  const noteFor = (record: ResultRecord): string | undefined =>
    notes[`${record.size}:${record.id}`];
  const combined: ReportDocument = {
    tree,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGiB: totalmem() / 1024 ** 3,
      platform: process.platform,
      sizes: SIZES,
    },
    fixtures: documents.flatMap((document) => document.fixtures),
    results: documents
      .flatMap((document) => document.results)
      .map((record) => {
        const note = noteFor(record);
        return note === undefined ? record : { ...record, note };
      }),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "results.json"), JSON.stringify(combined, null, 2));
  writeFileSync(join(out, "results.md"), renderReport(combined));
};

const main = async () => {
  const mode = process.argv[2];
  if (mode === "merge") return merge();
  if (mode === "child") return runChild();
  if (mode === "fixture") {
    const label = process.argv[3];
    if (!label || !isSize(label)) throw new Error("Unknown fixture size.");
    const fixture = await ensureFixture(label, log);
    log(
      `${label} fixture ${fixture.manifest.bytes} bytes in ${fixture.manifest.generationSeconds}s`,
    );
    return undefined;
  }
  return orchestrate();
};

main().then(
  () => process.exit(0),
  (cause: unknown) => {
    process.stderr.write(
      `${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    process.exit(1);
  },
);
