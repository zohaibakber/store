import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;

const bundleWorker = async () => {
  const bundle = await rolldown({
    input: `${repoRoot}apps/server/infra.ts`,
    cwd: repoRoot,
    platform: "neutral",
    external: [/^cloudflare:/, /^node:/, "lightningcss", "fsevents"],
    transform: { define: { "globalThis.__ALCHEMY_RUNTIME__": "true" } },
    checks: {
      unresolvedImport: false,
      ineffectiveDynamicImport: false,
      circularDependency: false,
    },
  });
  const { output } = await bundle.generate({
    format: "esm",
    minify: "dce-only",
    keepNames: true,
    strictExecutionOrder: true,
  });
  return output.flatMap((chunk) => (chunk.type === "chunk" ? [chunk] : []));
};

describe("API Worker bundle", () => {
  it("keeps control-plane calls, process.env hostnames, and import.meta.url out of the Worker", async () => {
    const chunks = await bundleWorker();
    const code = chunks.map((chunk) => chunk.code).join("\n");
    for (const operation of [
      "getConnectionURI",
      "createProject",
      "deleteProject",
      "updateProject",
      "createDatabase",
      "deleteDatabase",
    ]) {
      expect(code).not.toMatch(new RegExp(`\\b${operation}\\s*\\(`));
    }
    expect(code).not.toContain("@distilled.cloud/planetscale");
    expect(code).not.toMatch(/requireProductionApiHostname\s*\(\s*\)/);
    expect(code).not.toMatch(/requireProductionHostname\s*\(\s*\)/);
    const derived = chunks.flatMap((chunk) =>
      chunk.code
        .split("\n")
        .map((line, index) => `${chunk.fileName}:${index + 1}: ${line.trim()}`)
        .filter((line) => /new URL\([^)]*import\.meta\.url/.test(line)),
    );
    expect(derived).toEqual([]);
  }, 60_000);
});
