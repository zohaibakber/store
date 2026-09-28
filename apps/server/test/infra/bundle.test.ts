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
    const source = readFileSync(authDatabaseSource, "utf8");
    expect(source).not.toMatch(/new URL\s*\([^)]*import\.meta\.url/);
    expect(source).not.toContain("import.meta.url");
    expect(source).toContain('schema: "packages/db/src/auth/schema.ts"');
    expect(source).toContain('out: "packages/db/migrations/auth"');
  });

  it("pins Worker compatibility date to the workerd alchemy dev ships", () => {
    const source = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");
    expect(source).toContain('ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE = "2026-07-11"');
    expect(source).toContain("date: ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE");
  });

  it("treats blank protocol env as unset so GitHub Actions empty strings do not ship", () => {
    const source = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");
    expect(source).toContain('Config.withDefault("")');
    expect(source).toContain("fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)");
    expect(source).toContain("fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)");
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

  it("binds inventory commands through Hyperdrive and fans out through the stateless OrgHub", () => {
    const source = readFileSync(`${repoRoot}apps/server/infra.ts`, "utf8");
    expect(source).toContain("InventoryAuthorityLive");
    expect(source).toContain("InventoryCommands");
    expect(source).toContain("Hyperdrive.ConnectBinding");
    expect(source).not.toContain("OrganizationInventoryObject");
    expect(source).toContain("OrgHubLive");
    expect(source).not.toContain("DurableObjectStorage");
    expect(source).not.toContain("Neon");
  });

  it("does not call the database control plane from the Worker runtime", async () => {
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
  }, 60_000);

  it("does not require process.env production hostnames at Worker runtime", async () => {
    const chunks = await bundleWorker();
    const code = chunks.map((chunk) => chunk.code).join("\n");
    expect(code).not.toMatch(/requireProductionApiHostname\s*\(\s*\)/);
    expect(code).not.toMatch(/requireProductionHostname\s*\(\s*\)/);
  }, 60_000);

  it("never derives a URL from import.meta.url", async () => {
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
