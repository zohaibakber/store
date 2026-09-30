import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { MemoryTokenStore, layerSessionHttp, sessionFetch } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it } from "vitest";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";

const expiringTokens = () =>
  TokenSet.make({
    accessToken: AccessToken.make("access-1"),
    accessExpiresAt: Date.now() + 5_000,
    refreshToken: RefreshToken.make("session-1.secret"),
    refreshExpiresAt: Date.now() + 86_400_000,
  });

const harness = () => {
  const tokens = new MemoryTokenStore();
  tokens.set(expiringTokens());
  const sent: Array<string> = [];
  const send: typeof fetch = async (input, init) => {
    sent.push(new Request(input, init).url);
    return new Response(null, { status: 200 });
  };
  const runtime = ManagedRuntime.make(
    layerSessionHttp({
      apiBaseUrl: API,
      authBaseUrl: AUTH,
      tokens,
      credential: "refreshToken",
      onRefreshed: () => Effect.void,
      onRejected: Effect.void,
    }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, send)),
    ),
  );
  return {
    authenticatedFetch: sessionFetch((effect, options) => runtime.runPromise(effect, options)),
    sent,
  };
};

describe("authenticatedFetch", () => {
  it("refuses every origin but the API before touching the session", async () => {
    const test = harness();

    await expect(test.authenticatedFetch("https://elsewhere.example.test/x")).rejects.toThrow(
      TypeError,
    );
    await expect(test.authenticatedFetch(new URL("/v1/session", AUTH))).rejects.toThrow(TypeError);

    expect(test.sent).toEqual([]);
  });
});
