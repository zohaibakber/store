import {
  decodeSyncLiveServerFrame,
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PROTOCOL,
} from "@store/contracts";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import { admissionHeaders, type HubAdmission, type HubAttachment } from "../../src/live/hub-core";
import {
  makeOrgHub,
  type HubPlatform,
  type HubState,
  type OrgHubContract,
} from "../../src/live/org-hub";

const runtime = Context.make(RuntimeContext, {
  Type: "test",
  id: "org-hub-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

type FakeSocket = {
  readonly socket: Cloudflare.WebSocket;
  readonly sent: Array<string>;
  readonly closed: Array<readonly [number, string]>;
};

const fakeSocket = (): FakeSocket => {
  const sent: Array<string> = [];
  const closed: Array<readonly [number, string]> = [];
  let attachment: HubAttachment | null = null;
  const raw = {
    send: (text: string) => {
      sent.push(text);
    },
    close: (code: number, reason: string) => {
      closed.push([code, reason]);
    },
    serializeAttachment: (value: HubAttachment) => {
      attachment = structuredClone(value);
    },
    deserializeAttachment: () => attachment,
  };
  return {
    // SAFETY: the hub only calls send, close and the attachment accessors of a workerd socket.
    socket: Cloudflare.fromWebSocket(raw as Cloudflare.RawWebSocket),
    sent,
    closed,
  };
};

const makeHarness = () => {
  const accepted: Array<{ readonly socket: FakeSocket; readonly tags: ReadonlyArray<string> }> = [];
  const autoResponses: Array<WebSocketRequestResponsePair | undefined> = [];
  let next: FakeSocket | undefined;
  const state: HubState = {
    setWebSocketAutoResponse: (pair) =>
      Effect.sync(() => {
        autoResponses.push(pair);
      }),
    acceptWebSocket: (socket, tags) =>
      Effect.sync(() => {
        const fake = next;
        if (fake !== undefined && fake.socket === socket) {
          accepted.push({ socket: fake, tags: tags ?? [] });
        }
      }),
    getWebSockets: (tag) =>
      Effect.sync(() =>
        accepted
          .filter((entry) => tag === undefined || entry.tags.includes(tag))
          .map((entry) => entry.socket.socket),
      ),
  };
  const platform: HubPlatform = {
    autoResponse: () => ({ request: "ping", response: "pong" }),
    pair: () => {
      next = fakeSocket();
      // SAFETY: the client end is only passed back to platform.upgrade, which ignores it here.
      return { client: {} as WebSocket, server: next.socket };
    },
    upgrade: () =>
      HttpServerResponse.empty({
        status: 204,
        headers: { "sec-websocket-protocol": LIVE_SOCKET_PROTOCOL },
      }),
  };
  return { state, platform, accepted, autoResponses };
};

const admission = (overrides: Partial<HubAdmission> = {}): HubAdmission => ({
  replicaId: "replica-a",
  userId: "user-1",
  expiresAt: Date.now() + 60 * 60_000,
  maxBytes: null,
  epoch: "1",
  horizon: "5",
  ...overrides,
});

const upgradeRequest = (headers: Record<string, string>) =>
  HttpServerRequest.fromWeb(
    new Request("http://hub.invalid/api/sync/live", {
      headers: { upgrade: "websocket", ...headers },
    }),
  );

const run = <A>(effect: Effect.Effect<A, never, RuntimeContext>) =>
  Effect.runPromise(effect.pipe(Effect.provideContext(runtime)));

const group = (sequence: string) =>
  `{"commitSequence":"${sequence}","operationId":"op-${sequence}","decision":"accepted","changes":[]}`;

const connect = (hub: OrgHubContract, value: HubAdmission) =>
  hub.fetch.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      upgradeRequest(admissionHeaders(value)),
    ),
  );

const frames = (socket: FakeSocket) =>
  socket.sent.map((text) => Option.getOrThrow(decodeSyncLiveServerFrame(text)));

describe("OrgHub", () => {
  it("answers pings without waking and greets each socket with the current horizon", async () => {
    const harness = makeHarness();
    const outcome = await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        const response = yield* connect(hub, admission());
        return response.status;
      }),
    );
    expect(outcome).toBe(204);
    expect(harness.autoResponses).toHaveLength(1);
    expect(harness.accepted).toHaveLength(1);
    expect(harness.accepted[0]?.tags).toEqual(["replica:replica-a", "user:user-1"]);
    expect(frames(harness.accepted[0]!.socket)).toEqual([
      { _tag: "hello", epoch: "1", horizon: "5" },
    ]);
  });

  it("refuses a request that did not pass through the API Worker", async () => {
    const harness = makeHarness();
    const status = await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        const response = yield* hub.fetch.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, upgradeRequest({})),
        );
        return response.status;
      }),
    );
    expect(status).toBe(400);
    expect(harness.accepted).toHaveLength(0);
  });

  it("fans a commit out to every peer except the committing replica", async () => {
    const harness = makeHarness();
    const delivered = await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission({ replicaId: "replica-a" }));
        yield* connect(hub, admission({ replicaId: "replica-b", userId: "user-2" }));
        return yield* hub.publish({
          epoch: "1",
          horizon: "6",
          group: group("6"),
          byteLength: group("6").length,
          originReplicaId: "replica-a",
        });
      }),
    );
    const [origin, peer] = harness.accepted;
    expect(delivered).toBe(1);
    expect(frames(origin!.socket)).toHaveLength(1);
    expect(frames(peer!.socket).at(-1)).toEqual({
      _tag: "transactions",
      epoch: "1",
      subscription: "operational",
      schemaVersion: 1,
      fromCommitSequence: "6",
      toCommitSequence: "6",
      transactions: [
        { commitSequence: "6", operationId: "op-6", decision: "accepted", changes: [] },
      ],
    });
  });

  it("sends a wake instead of the group when it exceeds the socket's byte budget", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission({ replicaId: "replica-small", maxBytes: 10 }));
        yield* hub.publish({
          epoch: "1",
          horizon: "6",
          group: group("6"),
          byteLength: 4_096,
          originReplicaId: "replica-a",
        });
      }),
    );
    expect(frames(harness.accepted[0]!.socket).at(-1)).toEqual({
      _tag: "wake",
      epoch: "1",
      horizon: "6",
    });
  });

  it("tells peers to resume when the epoch changes", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission({ replicaId: "replica-b" }));
        yield* hub.publish({
          epoch: "2",
          horizon: "1",
          group: group("1"),
          byteLength: 10,
          originReplicaId: "replica-a",
        });
      }),
    );
    expect(frames(harness.accepted[0]!.socket).at(-1)).toMatchObject({
      _tag: "resume",
      epoch: "2",
      reason: "epoch_changed",
    });
  });

  it("still tells a socket to resume after the hub was evicted and woken", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const before = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(before, admission({ replicaId: "replica-old", epoch: "1" }));
        yield* connect(before, admission({ replicaId: "replica-new", epoch: "2", horizon: "0" }));
        const woken = yield* makeOrgHub(harness.state, harness.platform);
        yield* woken.publish({
          epoch: "2",
          horizon: "1",
          group: group("1"),
          byteLength: 10,
          originReplicaId: "replica-a",
        });
        yield* woken.publish({
          epoch: "2",
          horizon: "2",
          group: group("2"),
          byteLength: 10,
          originReplicaId: "replica-a",
        });
      }),
    );
    const [old, current] = harness.accepted.map((entry) =>
      frames(entry.socket).map((frame) => frame._tag),
    );
    expect(old).toEqual(["hello", "resume", "transactions"]);
    expect(current).toEqual(["hello", "transactions", "transactions"]);
  });

  it("greets a later socket with a horizon a publish advanced past the Worker's read", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* hub.publish({
          epoch: "1",
          horizon: "9",
          group: group("9"),
          byteLength: 10,
          originReplicaId: "replica-a",
        });
        yield* connect(hub, admission({ replicaId: "replica-late", horizon: "8" }));
      }),
    );
    expect(frames(harness.accepted[0]!.socket)).toEqual([
      { _tag: "hello", epoch: "1", horizon: "9" },
    ]);
  });

  it("closes a socket whose token expired instead of delivering to it", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission({ replicaId: "replica-old", expiresAt: 1 }));
        yield* connect(hub, admission({ replicaId: "replica-quiet", expiresAt: 2 }));
        yield* hub.webSocketMessage(harness.accepted[1]!.socket.socket, "hello?");
        yield* hub.publish({
          epoch: "1",
          horizon: "6",
          group: group("6"),
          byteLength: 10,
          originReplicaId: "replica-a",
        });
      }),
    );
    const [expired, quiet] = harness.accepted;
    expect(frames(expired!.socket)).toHaveLength(1);
    expect(expired!.socket.closed[0]?.[0]).toBe(LIVE_SOCKET_CLOSE.tokenExpired);
    expect(quiet!.socket.closed[0]?.[0]).toBe(LIVE_SOCKET_CLOSE.tokenExpired);
  });

  it("closes every socket of a revoked member and no one else's", async () => {
    const harness = makeHarness();
    const closed = await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission({ replicaId: "replica-a", userId: "user-1" }));
        yield* connect(hub, admission({ replicaId: "replica-b", userId: "user-1" }));
        yield* connect(hub, admission({ replicaId: "replica-c", userId: "user-2" }));
        return yield* hub.revoke("user-1");
      }),
    );
    expect(closed).toBe(2);
    expect(harness.accepted.map((entry) => entry.socket.closed[0]?.[0])).toEqual([
      LIVE_SOCKET_CLOSE.revoked,
      LIVE_SOCKET_CLOSE.revoked,
      undefined,
    ]);
  });

  it("replaces an older socket of the same replica", async () => {
    const harness = makeHarness();
    await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(hub, admission());
        yield* connect(hub, admission());
      }),
    );
    expect(harness.accepted[0]!.socket.closed).toEqual([[LIVE_SOCKET_CLOSE.normal, "replaced"]]);
    expect(harness.accepted[1]!.socket.closed).toEqual([]);
  });
});
