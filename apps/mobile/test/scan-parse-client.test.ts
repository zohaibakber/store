import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETRY_AFTER_MILLIS,
  ScanFailed,
  ScanOffline,
  ScanRateLimited,
  ScanRejected,
  parseProductScan,
  retryAfterMillis,
  scanFailureFor,
} from "../src/scan/parse-client";

const result = {
  name: "Panadol Extra",
  composition: "Paracetamol",
  strength: "500mg",
  unitsPerPack: 20,
  batchNumber: "AB1234",
  expiresAt: "2027-08",
  confidence: 0.9,
};

type ResponseBody =
  | typeof result
  | { readonly error: { readonly code: string; readonly message: string } }
  | { readonly confidence: number };

const json = (status: number, body: ResponseBody, retryAfter?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers:
      retryAfter === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", "retry-after": retryAfter },
  });

const run = (respond: (request: Request) => Promise<Response>) => {
  const requests: Array<Request> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  };
  const exit = Effect.runPromiseExit(
    parseProductScan("https://api.example.test", {
      recognizedText: "PANADOL EXTRA",
      mode: "product",
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    ),
  );
  return { exit, requests };
};

const failure = async <A, E>(exit: Promise<Exit.Exit<A, E>>) => {
  const settled = await exit;
  if (Exit.isSuccess(settled)) throw new Error("Expected the scan to fail.");
  const error = settled.cause.reasons.find((reason) => reason._tag === "Fail");
  if (error?._tag !== "Fail") throw new Error("Expected a typed failure.");
  return error.error;
};

describe("retryAfterMillis", () => {
  it("reads seconds and HTTP dates and defaults to a minute", () => {
    const now = Date.parse("2026-09-24T10:00:00Z");
    expect(retryAfterMillis("42", now)).toBe(42_000);
    expect(retryAfterMillis("Thu, 24 Sep 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterMillis(undefined, now)).toBe(DEFAULT_RETRY_AFTER_MILLIS);
    expect(retryAfterMillis("soon", now)).toBe(DEFAULT_RETRY_AFTER_MILLIS);
  });
});

describe("scanFailureFor", () => {
  it("maps statuses to recoverable scan states", () => {
    expect(scanFailureFor(429, "10", 1000, null)).toEqual(new ScanRateLimited({ retryAt: 11_000 }));
    expect(scanFailureFor(502, undefined, 0, "Try again.")).toEqual(
      new ScanFailed({ message: "Try again." }),
    );
    expect(scanFailureFor(401, undefined, 0, null)).toEqual(
      new ScanRejected({ status: 401, message: "Sign in again to auto-fill scans." }),
    );
  });
});

describe("parseProductScan", () => {
  it("posts the recognised text and decodes the result", async () => {
    const { exit, requests } = run(async () => json(200, result));
    expect(await exit).toEqual(Exit.succeed(result));
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.example.test/api/product-scans");
    expect(await request?.json()).toEqual({ recognizedText: "PANADOL EXTRA", mode: "product" });
  });

  it("reports a rate limit with the server's retry window", async () => {
    const before = Date.now();
    const error = await failure(
      run(async () =>
        json(
          429,
          { error: { code: "PRODUCT_SCAN_RATE_LIMITED", message: "Too many scans." } },
          "5",
        ),
      ).exit,
    );
    expect(error).toBeInstanceOf(ScanRateLimited);
    expect(error instanceof ScanRateLimited && error.retryAt - before).toBeGreaterThanOrEqual(5000);
  });

  it("reports a failed parse with the server's message", async () => {
    const error = await failure(
      run(async () =>
        json(502, {
          error: {
            code: "PRODUCT_SCAN_FAILED",
            message: "Could not parse the scan text. Try again.",
          },
        }),
      ).exit,
    );
    expect(error).toEqual(new ScanFailed({ message: "Could not parse the scan text. Try again." }));
  });

  it("reports a network failure as offline", async () => {
    const error = await failure(
      run(() => Promise.reject(new TypeError("Network request failed"))).exit,
    );
    expect(error).toBeInstanceOf(ScanOffline);
  });

  it("rejects an unreadable success body as a failed parse", async () => {
    const error = await failure(run(async () => json(200, { confidence: 3 })).exit);
    expect(error).toBeInstanceOf(ScanFailed);
  });
});
