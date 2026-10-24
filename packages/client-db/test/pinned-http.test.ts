import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import { makePinnedHttp } from "../src/replica/pinned-http";

const API = "https://api.example.com";

type Sent = {
  readonly url: string;
  readonly authorization: string | null;
  readonly redirect: RequestRedirect | undefined;
};

const server = (answer: (sent: Sent) => Response) => {
  const sent: Array<Sent> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const seen = {
      url: input instanceof Request ? input.url : new URL(input).href,
      authorization: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
    };
    sent.push(seen);
    return answer(seen);
  };
  return { sent, fetch };
};

const withHttp = <A>(
  fetch: typeof globalThis.fetch,
  use: (http: Effect.Success<ReturnType<typeof makePinnedHttp>>) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    makePinnedHttp(API).pipe(
      Effect.flatMap(use),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.scoped,
    ),
  );

const token = (value: string) => Redacted.make(value);

describe("the origin-pinned API client", () => {
  it("attaches the token to the API origin and never follows a redirect", async () => {
    const api = server(() => new Response("{}"));
    await withHttp(api.fetch, (http) =>
      Effect.gen(function* () {
        yield* http.setToken(token("access-1"));
        yield* http.client.execute(HttpClientRequest.get(`${API}/api/sync/receipts/op-1`));
      }),
    );
    expect(api.sent).toEqual([
      {
        url: `${API}/api/sync/receipts/op-1`,
        authorization: "Bearer access-1",
        redirect: "manual",
      },
    ]);
  });

  it.each([
    ["a URL that carries credentials", "https://user:secret@api.example.com/api/sync/pull"],
    ["a URL on another origin", "https://files.example.net/snapshots/1/parts/1"],
    ["the API host on another scheme", "http://api.example.com/api/sync/pull"],
  ])("refuses %s without sending anything", async (_name, url) => {
    const api = server(() => new Response("{}"));
    const exit = await withHttp(api.fetch, (http) =>
      Effect.gen(function* () {
        yield* http.setToken(token("access-1"));
        return yield* Effect.exit(http.client.execute(HttpClientRequest.get(url)));
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(api.sent).toEqual([]);
  });

  it("fails on a redirect instead of carrying the token to its target", async () => {
    const api = server(
      () =>
        new Response(null, { status: 302, headers: { location: "https://files.example.net/" } }),
    );
    const exit = await withHttp(api.fetch, (http) =>
      Effect.gen(function* () {
        yield* http.setToken(token("access-1"));
        return yield* Effect.exit(
          http.client.execute(HttpClientRequest.get(`${API}/api/sync/snapshots/s-1/parts/1`)),
        );
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("StatusCodeError");
    expect(api.sent.map((sent) => sent.url)).toEqual([`${API}/api/sync/snapshots/s-1/parts/1`]);
  });
});
