import { readFileSync } from "node:fs";

import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../", import.meta.url).pathname;
const authDatabaseSource = `${repoRoot}packages/db/src/auth/infra.ts`;

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
  it("gives Drizzle.Schema cwd-relative paths, not import.meta.url", () => {
    // Alchemy's D1 + Drizzle guide passes `schema: "./src/schema.ts"` strings
    // resolved from process.cwd(). `new URL(..., import.meta.url)` is a Worker
    // crash on workerd even when tucked behind a runtime guard.
    const source = readFileSync(authDatabaseSource, "utf8");
    expect(source).not.toMatch(/new URL\s*\([^)]*import\.meta\.url/);
    expect(source).not.toContain("import.meta.url");
    expect(source).toContain('schema: "packages/db/src/auth/schema.ts"');
    expect(source).toContain('out: "packages/db/migrations/auth"');
  });

  it("uses first-party JWT verification without an auth framework", () => {
    const source = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");
    expect(source).not.toContain("@alchemy.run/better-auth");
    expect(source).not.toContain("makeAuth(");
    expect(source).not.toContain("better-auth");
    expect(source).not.toMatch(/clerk/iu);
    expect(source).toContain("AUTH_JWT_PUBLIC_JWK");
    expect(source).toContain("AuthVerificationConfig");
  });

  it("does not bind an organization Durable Object", () => {
    const source = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");
    expect(source).not.toContain("ORGANIZATION_STORE");
    expect(source).not.toContain("OrganizationStore");
    expect(source).not.toContain("connectSyncLive");
  });

  it("does not call the Neon API from the Worker runtime", async () => {
    const chunks = await bundleWorker();
    const code = chunks.map((chunk) => chunk.code).join("\n");
    expect(code).not.toContain("getConnectionURI");
    expect(code).not.toContain("resetProjectBranchRolePassword");
  }, 60_000);

  it("does not require process.env production hostnames at Worker runtime", async () => {
    // `requireProductionApiHostname()` reads process.env and throws. The
    // Worker bundle folds `__ALCHEMY_RUNTIME__` to true, so that deploy-time
    // call must be eliminated or every request 1101s (seen as a CORS error).
    const chunks = await bundleWorker();
    const code = chunks.map((chunk) => chunk.code).join("\n");
    expect(code).not.toMatch(/requireProductionApiHostname\s*\(\s*\)/);
    expect(code).not.toMatch(/requireProductionHostname\s*\(\s*\)/);
  }, 60_000);

  it("never derives a URL from import.meta.url", async () => {
    // workerd leaves `import.meta.url` undefined, so `new URL(relative,
    // import.meta.url)` throws `TypeError: Invalid URL string.` there. The
    // Worker yields AuthDatabase on every request; those paths must be plain
    // cwd-relative strings, the way Alchemy's D1 + Drizzle guide writes them.
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
