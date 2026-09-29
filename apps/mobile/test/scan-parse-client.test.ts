import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it } from "vitest";

import {
  ScanFailed,
  ScanOffline,
  ScanRateLimited,
  ScanRejected,
  parseProductScan,
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

describe("parseProductScan", () => {
  it("posts the recognised text and decodes the result", async () => {
    const { exit, requests } = run(async () => json(200, result));
    expect(await exit).toEqual(Exit.succeed(result));
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.example.test/api/product-scans");
    expect(await request?.json()).toEqual({ recognizedText: "PANADOL EXTRA", mode: "product" });
  });

  it.each([
    ["seconds", "5", 5_000],
    ["an HTTP date", "in 30s", 30_000],
    ["no header", undefined, 60_000],
    ["an unreadable header", "soon", 60_000],
  ])("reports a rate limit with a retry window from %s", async (_, header, window) => {
    const retryAfter = header === "in 30s" ? new Date(Date.now() + 30_000).toUTCString() : header;
    const before = Date.now();
    const error = await failure(
      run(async () =>
        json(
          429,
          { error: { code: "PRODUCT_SCAN_RATE_LIMITED", message: "Too many scans." } },
          retryAfter,
        ),
      ).exit,
    );
    expect(error).toBeInstanceOf(ScanRateLimited);
    const wait = error instanceof ScanRateLimited ? error.retryAt - before : 0;
    expect(wait).toBeGreaterThan(window - 1_500);
    expect(wait).toBeLessThanOrEqual(window + 1_000);
  });

  it.each([
    [
      502,
      {
        error: {
          code: "PRODUCT_SCAN_FAILED",
          message: "Could not parse the scan text. Try again.",
        },
      },
      new ScanFailed({ message: "Could not parse the scan text. Try again." }),
    ],
    [
      401,
      { confidence: 0 },
      new ScanRejected({ status: 401, message: "Sign in again to auto-fill scans." }),
    ],
  ] as const)("reports a %d refusal", async (status, body, expected) => {
    const error = await failure(run(async () => json(status, body)).exit);
    expect(error).toEqual(expected);
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
