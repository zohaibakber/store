import { describe, expect, it } from "vitest";

import { appFor } from "../lib/app";

describe("HTTP auth and CORS", () => {
  it("serves health without constructing an absolute request URL", async () => {
    const response = await appFor(true).request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("forwards Better Auth session lookups instead of crashing", async () => {
    const response = await appFor(true).request("/api/auth/get-session");
    expect(response.status).toBe(404);
  });

  it("adds CORS headers on API routes for a trusted origin", async () => {
    const response = await appFor(true).request("/api/health", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("adds CORS headers for the local web Vite origin", async () => {
    const response = await appFor(true).request("/api/health", {
      headers: { origin: "http://localhost:5174" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
  });
});
