import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;

/**
 * Bundles the API Worker the way a deploy does: `__ALCHEMY_RUNTIME__` folded to
 * `true` so plan-only branches become dead code, then DCE. The Cloudflare
 * plugin is left out — nothing here depends on its rewrites, and the runtime
 * modules are external.
 */
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
  it("never derives a URL from import.meta.url", async () => {
    // workerd leaves `import.meta.url` undefined, so `new URL(relative,
    // import.meta.url)` throws `TypeError: Invalid URL string.` there. Sitting
    // in code the Worker reaches — resolving a binding, building the auth
    // config — that fails the Worker before it serves anything and every
    // request 500s. Deploy-time paths belong behind
    // `if (!globalThis.__ALCHEMY_RUNTIME__)`, which the bundler folds away.
    const chunks = await bundleWorker();
    const derived = chunks.flatMap((chunk) =>
      chunk.code
        .split("\n")
        .map((line, index) => `${chunk.fileName}:${index + 1}: ${line.trim()}`)
        .filter((line) => /new URL\([^)]*import\.meta\.url/.test(line)),
    );

    expect(derived).toEqual([]);
  }, 60_000);
});
