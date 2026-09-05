import { CatalogPullRequest } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";
import { describe, expect, it } from "vitest";

import { recoverUnexpected } from "../../src/http/app";
import { appFor } from "../lib/app";

describe("HTTP auth and CORS", () => {
  it("serves health without constructing an absolute request URL", async () => {
    const response = await appFor(true).request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns an unauthenticated workspace snapshot for session lookups", async () => {
    const response = await appFor(false).request("/api/auth/session");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unauthenticated" });
  });

  it("lists catalog replica routes on the landing page", async () => {
    const response = await appFor(true).request("/");
    expect(response.status).toBe(200);
    const body = Schema.decodeUnknownSync(
      Schema.Struct({
        service: Schema.String,
        endpoints: Schema.Array(Schema.String),
      }),
    )(await response.json());
    expect(body).toMatchObject({ service: "Store Invoice API" });
    expect(body.endpoints).toContain("/api/inventory/*");
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

  it("adds CORS headers on a valid catalog pull", async () => {
    const response = await appFor(true).request("/api/inventory/pull", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ epoch: 2, cursor: 0, slices: ["catalog"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(await response.json()).toMatchObject({ epoch: 2, cursor: 0, hasMore: false });
  });

  it("answers an invalid catalog pull as 400 with CORS headers", async () => {
    const response = await appFor(true).request("/api/inventory/pull", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ cursor: 0, slices: ["catalog"] }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("does not turn a catalog payload schema defect into a 500", async () => {
    const payloadError = await Effect.runPromise(
      Schema.decodeUnknownEffect(CatalogPullRequest)({ cursor: 0, slices: ["catalog"] }).pipe(
        Effect.mapError((cause) => new HttpApiSchemaError({ kind: "Payload", cause })),
        Effect.flip,
      ),
    );
    const response = HttpServerResponse.toWeb(
      await Effect.runPromise(recoverUnexpected(Effect.die(payloadError))),
    );
    expect(response.status).toBe(400);
  });

  it("keeps unexpected defects as a JSON 500", async () => {
    const response = HttpServerResponse.toWeb(
      await Effect.runPromise(recoverUnexpected(Effect.die(new Error("isolate exploded")))),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("adds CORS headers on a valid catalog snapshot", async () => {
    const response = await appFor(true).request("/api/inventory/snapshot", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ epoch: 2, slices: ["catalog"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("answers an invalid catalog snapshot as 400 with CORS headers", async () => {
    const response = await appFor(true).request("/api/inventory/snapshot", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slices: ["catalog"] }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
