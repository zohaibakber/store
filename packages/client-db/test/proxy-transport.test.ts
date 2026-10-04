import { OrgCommitSequence, SyncEpoch, type SyncPullRequest } from "@store/contracts";
import { SyncTransportService } from "@store/sync";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  layerProxySyncTransport,
  type SyncProxyRequest,
  type SyncProxyResponse,
} from "../src/replica/proxy-transport";

const pullRequest: SyncPullRequest = {
  epoch: SyncEpoch.make("1"),
  subscription: "operational",
  afterCommitSequence: OrgCommitSequence.make("4"),
};

const page = {
  epoch: "1",
  incarnation: "authority-1",
  subscription: "operational",
  schemaVersion: 2,
  transactions: [],
  nextCommitSequence: "4",
  horizon: "4",
  retentionFloor: "0",
};

const pullThrough = <E>(
  bridge: (request: SyncProxyRequest) => Effect.Effect<SyncProxyResponse, E>,
) =>
  Effect.runPromise(
    SyncTransportService.use((transport) => transport.pull(pullRequest)).pipe(
      Effect.result,
      Effect.provide(layerProxySyncTransport(bridge)),
    ),
  );

const answering = (response: SyncProxyResponse) => () => Effect.succeed(response);

describe("proxy sync transport", () => {
  it("posts the route through the bridge and decodes a 200 page", async () => {
    const carried: Array<SyncProxyRequest> = [];
    const result = await pullThrough((request) => {
      carried.push(request);
      return Effect.succeed({ ok: true, status: 200, bodyText: JSON.stringify(page) });
    });
    expect(result).toMatchObject({ _tag: "Success", success: page });
    expect(carried).toStrictEqual([
      {
        method: "POST",
        pathname: "/api/sync/pull",
        bodyText: JSON.stringify(pullRequest),
        timeoutMillis: 30_000,
      },
    ]);
  });

  it("turns a 409 protocol error body into SyncProtocolError", async () => {
    const result = await pullThrough(
      answering({
        ok: false,
        status: 409,
        bodyText: JSON.stringify({
          error: { code: "EPOCH_MISMATCH", message: "The authority epoch changed." },
        }),
      }),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "SyncProtocolError",
        code: "EPOCH_MISMATCH",
        message: "The authority epoch changed.",
      },
    });
  });

  it("turns a 503 with retryAfter into SyncTransportUnavailable with the delay", async () => {
    const result = await pullThrough(
      answering({ ok: false, status: 503, bodyText: "Service Unavailable", retryAfter: "7" }),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SyncTransportUnavailable", status: 503, retryAfterMillis: 7_000 },
    });
  });

  it("turns an HTML 200 into SyncTransportGarbled", async () => {
    const result = await pullThrough(
      answering({ ok: true, status: 200, bodyText: "<!doctype html><title>Sign in</title>" }),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SyncTransportGarbled" },
    });
  });

  it("turns a bridge rejection into SyncTransportOffline", async () => {
    const result = await pullThrough(() => Effect.fail("The replica worker port closed."));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SyncTransportOffline" },
    });
  });
});
