import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeElectricProxy } from "../../src/electric/proxy";

describe("Electric shape proxy", () => {
  it.effect("sets the tenant shape server-side and forwards only protocol parameters", () => {
    let requestedUrl: URL | undefined;
    const fetchUpstream: typeof fetch = (input) => {
      requestedUrl = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      );
      return Promise.resolve(
        new Response("shape-data", {
          status: 200,
          headers: {
            "content-encoding": "gzip",
            "content-length": "99",
            "electric-offset": "42",
          },
        }),
      );
    };
    const proxy = makeElectricProxy(
      {
        kind: "enabled",
        baseUrl: "https://electric.example",
        sourceId: "source-1",
        sourceSecret: Redacted.make("server-secret"),
      },
      fetchUpstream,
    );

    return Effect.gen(function* () {
      const result = yield* proxy({
        table: "products",
        organizationId: "org-1",
        request: new Request(
          "https://api.example/api/electric/products?offset=7&live=true&table=users&where=true&secret=stolen",
        ),
      });
      const response = HttpServerResponse.toWeb(result);

      expect(requestedUrl?.pathname).toBe("/v1/shape");
      expect(requestedUrl?.searchParams.get("offset")).toBe("7");
      expect(requestedUrl?.searchParams.get("live")).toBe("true");
      expect(requestedUrl?.searchParams.get("table")).toBe("products");
      expect(requestedUrl?.searchParams.get("where")).toBe('"organization_id" = $1');
      expect(requestedUrl?.searchParams.get("params[1]")).toBe("org-1");
      expect(requestedUrl?.searchParams.get("source_id")).toBe("source-1");
      expect(requestedUrl?.searchParams.get("secret")).toBe("server-secret");
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).toBeNull();
      expect(response.headers.get("electric-offset")).toBe("42");
      expect(response.headers.get("vary")).toBe("Authorization");
      expect(yield* Effect.promise(() => response.text())).toBe("shape-data");
    });
  });

  it.effect("fails closed while Electric is not configured", () =>
    Effect.gen(function* () {
      const proxy = makeElectricProxy({ kind: "disabled" });
      const result = yield* proxy({
        table: "categories",
        organizationId: "org-1",
        request: new Request("https://api.example/api/electric/categories?offset=-1"),
      });
      const response = HttpServerResponse.toWeb(result);

      expect(response.status).toBe(503);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        error: { code: "ELECTRIC_NOT_CONFIGURED" },
      });
    }),
  );

  it.effect("maps upstream connection failures to a public gateway error", () => {
    const fetchUpstream: typeof fetch = () => Promise.reject(new Error("private upstream host"));
    const proxy = makeElectricProxy(
      {
        kind: "enabled",
        baseUrl: "https://electric.example",
        sourceId: undefined,
        sourceSecret: undefined,
      },
      fetchUpstream,
    );

    return Effect.gen(function* () {
      const result = yield* proxy({
        table: "batches",
        organizationId: "org-1",
        request: new Request("https://api.example/api/electric/batches?offset=-1"),
      });
      const response = HttpServerResponse.toWeb(result);
      const body = JSON.stringify(yield* Effect.promise(() => response.json()));

      expect(response.status).toBe(502);
      expect(body).toContain("ELECTRIC_UNAVAILABLE");
      expect(body).not.toContain("private upstream host");
    });
  });
});
