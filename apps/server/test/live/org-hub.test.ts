import {
  decodeSyncLiveServerFrame,
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PROTOCOL,
} from "@store/contracts";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import type { OrgHubContract } from "../../api";
import { admissionHeaders, type HubAdmission, type HubAttachment } from "../../src/live/hub-core";
import { makeOrgHub, type HubPlatform, type HubState } from "../../src/live/org-hub";

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
  let next: FakeSocket | undefined;
  let alarmAt: number | null = null;
  const state: HubState = {
    setWebSocketAutoResponse: () => Effect.void,
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
          .filter((entry) => entry.socket.closed.length === 0)
          .map((entry) => entry.socket.socket),
      ),
    storage: {
      getAlarm: () => Effect.sync(() => alarmAt),
      setAlarm: (at) =>
        Effect.sync(() => {
          alarmAt = new Date(at).getTime();
        }),
      deleteAlarm: () =>
        Effect.sync(() => {
          alarmAt = null;
        }),
    },
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
  return { state, platform, accepted, alarm: () => alarmAt };
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

  it("keeps the alarm at the earliest expiry and closes idle sockets when it fires", async () => {
    const harness = makeHarness();
    const now = Date.now();
    const later = now + 2 * 60 * 60_000;
    const sooner = now + 60 * 60_000;
    const scheduled = await run(
      Effect.gen(function* () {
        const hub = yield* makeOrgHub(harness.state, harness.platform);
        yield* connect(
          hub,
          admission({ replicaId: "replica-later", userId: "user-1", expiresAt: later }),
        );
        const first = harness.alarm();
        yield* connect(
          hub,
          admission({ replicaId: "replica-sooner", userId: "user-1", expiresAt: sooner }),
        );
        const pulled = harness.alarm();
        yield* connect(
          hub,
          admission({ replicaId: "replica-idle", userId: "user-2", expiresAt: 1 }),
        );
        const idle = harness.alarm();
        yield* hub.alarm();
        const afterSweep = harness.alarm();
        yield* hub.alarm();
        const afterRepeat = harness.alarm();
        yield* hub.revoke("user-1");
        yield* hub.alarm();
        return { first, pulled, idle, afterSweep, afterRepeat, empty: harness.alarm() };
      }),
    );
    expect(scheduled).toEqual({
      first: later,
      pulled: sooner,
      idle: 1,
      afterSweep: sooner,
      afterRepeat: sooner,
      empty: null,
    });
    expect(harness.accepted.map((entry) => entry.socket.closed)).toEqual([
      [[LIVE_SOCKET_CLOSE.revoked, "membership revoked"]],
      [[LIVE_SOCKET_CLOSE.revoked, "membership revoked"]],
      [[LIVE_SOCKET_CLOSE.tokenExpired, "token expired"]],
    ]);
  });
});
