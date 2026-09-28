import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { workerRuntimeServices } from "../../src/http/app";
import { appFor } from "../lib/app";

describe("HTTP auth and CORS", () => {
  it("dies during isolate init when Alchemy omitted RuntimeContext", async () => {
    await expect(Effect.runPromise(workerRuntimeServices)).rejects.toThrow(
      "Alchemy did not provide the Worker RuntimeContext.",
    );
  });

  it("serves health without constructing an absolute request URL", async () => {
    const response = await appFor(true).request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers unknown routes with 404 instead of an internal error", async () => {
    const app = appFor(true);
    expect((await app.request("/api/sync/snapshot", { method: "POST" })).status).toBe(404);
    expect((await app.request("/healthz")).status).toBe(404);
  });

  it("returns an unauthenticated workspace snapshot for session lookups", async () => {
    const response = await appFor(false).request("/api/auth/session");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unauthenticated" });
  });

  it("adds CORS headers on API routes for a trusted origin", async () => {
    const response = await appFor(true).request("/api/health", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("answers a session preflight for a trusted origin without using *", async () => {
    const response = await appFor(false).request("/api/auth/session", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("adds CORS headers for the local web Vite origin", async () => {
    const response = await appFor(true).request("/api/health", {
      headers: { origin: "http://localhost:5174" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
  });

  it("allows a CORS origin that a wildcard trusted origin covers", async () => {
    const app = appFor(true, {
      trustedOrigins: ["https://*.tabaaq.example.com"],
    });

    const covered = await app.request("/api/health", {
      headers: { origin: "https://preview-42.tabaaq.example.com" },
    });
    expect(covered.headers.get("access-control-allow-origin")).toBe(
      "https://preview-42.tabaaq.example.com",
    );

    const other = await app.request("/api/health", {
      headers: { origin: "https://tabaaq.example.net" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
