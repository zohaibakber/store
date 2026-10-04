import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vitest";

import { parseProductScan } from "../src/scan/parse-client";

const API = "https://api.example.test";

const refusal = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: "REFUSED", message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const failureOf = (respond: (request: Request) => Response) => {
  const seen: Array<string> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push(`${request.method} ${request.url} ${await request.text()}`);
    return respond(request);
  };
  return Effect.runPromise(
    parseProductScan(API, { recognizedText: "Panadol 500mg", mode: "product" }).pipe(
      Effect.flip,
      Effect.provide(
        Layer.merge(
          TestClock.layer(),
          FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
        ),
      ),
    ),
  ).then((failure) => ({ failure, seen }));
};

describe("parseProductScan", () => {
  it("waits as long as a rate-limited answer's Retry-After header says", async () => {
    const limited = await failureOf(() => refusal(429, "Too many scans.", { "retry-after": "7" }));
    expect(limited.failure).toMatchObject({ _tag: "ScanRateLimited", retryAt: 7_000 });
    expect(limited.seen).toEqual([
      `POST ${API}/api/product-scans {"recognizedText":"Panadol 500mg","mode":"product"}`,
    ]);
    const unhinted = await failureOf(() => refusal(429, "Too many scans."));
    expect(unhinted.failure).toMatchObject({ _tag: "ScanRateLimited", retryAt: 60_000 });
  });

  it("keeps the status of an auth refusal the contract does not declare", async () => {
    const signedOut = await failureOf(() => refusal(401, "Sign in required."));
    expect(signedOut.failure).toMatchObject({
      _tag: "ScanRejected",
      status: 401,
      message: "Sign in required.",
    });
    const forbidden = await failureOf(() => new Response("denied", { status: 403 }));
    expect(forbidden.failure).toMatchObject({
      _tag: "ScanRejected",
      status: 403,
      message: "Sign in again to auto-fill scans.",
    });
  });
});
