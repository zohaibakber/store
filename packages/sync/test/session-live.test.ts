import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PING,
  LIVE_SOCKET_PONG,
  LIVE_SOCKET_PROTOCOL,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import type * as Socket from "effect/unstable/socket/Socket";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { accessTokenExpiresAt, liveSocketUrl, type LiveNetworkSignal } from "../src/live-socket";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { startOwnedHttpSync } from "../src/session";
import type { SyncTransport } from "../src/transport";

const databaseName = "session-live";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

type Listener = (event: Socket.WebSocketEvent) => void;

class FakeSocket implements Socket.WebSocketLike {
  readyState = 0;
  readonly sent: Array<string> = [];
  closedWith: number | undefined;
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly url: string,
    readonly protocols: Socket.WebSocketConstructorOptions | undefined,
  ) {}

  addEventListener(type: string, listener: Listener) {
    const set = this.#listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  close(code?: number) {
    this.readyState = 3;
    this.closedWith = code ?? 1000;
  }

  send(data: string | Uint8Array<ArrayBuffer>) {
    const text = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
    this.sent.push(text);
    if (text === LIVE_SOCKET_PING) this.message(LIVE_SOCKET_PONG);
  }

  open() {
    this.readyState = 1;
    this.#emit("open", {});
  }

  message(data: string) {
    this.#emit("message", { data });
  }

  drop(code: number) {
    this.readyState = 3;
    this.#emit("close", { code, reason: "" });
  }

  #emit(type: string, event: Socket.WebSocketEvent) {
    for (const listener of Array.from(this.#listeners.get(type) ?? [])) listener(event);
  }
}

const base64Url = (value: string) =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const tokenExpiringAt = (millis: number) =>
  `${base64Url('{"alg":"ES256"}')}.${base64Url(JSON.stringify({ exp: millis / 1_000 }))}.sig`;

const makeTransport = (pulls: Ref.Ref<number>): SyncTransport => ({
  registerReplica: (request) =>
    Effect.succeed({
      replicaId: request.replicaId,
      epoch: LAST_UNIT_EPOCH,
      incarnation: AuthorityIncarnation.make("authority-1"),
      nextClientSequence: ReplicaClientSequence.make("1"),
      retentionFloor: OrgCommitSequence.make("0"),
      horizon: OrgCommitSequence.make("0"),
      schemaVersion: 1,
    }),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: (request) =>
    Ref.update(pulls, (count) => count + 1).pipe(
      Effect.as({
        epoch: LAST_UNIT_EPOCH,
        incarnation: AuthorityIncarnation.make("authority-1"),
        subscription: OPERATIONAL_SUBSCRIPTION,
        schemaVersion: 1,
        transactions: [],
        nextCommitSequence: request.afterCommitSequence,
        horizon: OrgCommitSequence.make("0"),
        retentionFloor: OrgCommitSequence.make("0"),
      }),
    ),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
});

const controllableNetwork = () => {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  const signal: LiveNetworkSignal = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    signal,
    set: (value: boolean) => {
      online = value;
      for (const listener of listeners) listener(value);
    },
  };
};

const settle = Effect.repeat(TestClock.adjust("0 millis"), { times: 20 });

const startLive = (options: { readonly token: string }) =>
  Effect.gen(function* () {
    const store = yield* makeIndexedDbReplicaStore({
      databaseName,
      databaseIdentity: databaseName,
      identity: {
        organizationId: "org-live",
        userId: "user-1",
        replicaId: "replica-1",
      },
      indexedDB,
      IDBKeyRange,
    });
    const sockets = yield* Queue.unbounded<FakeSocket>();
    const tokenRequests: Array<{ readonly force: boolean }> = [];
    const pulls = yield* Ref.make(0);
    const network = controllableNetwork();
    const owned = yield* startOwnedHttpSync(store, makeTransport(pulls), databaseName, {
      apiBaseUrl: "https://api.tabaaq.test",
      accessToken: async (request) => {
        tokenRequests.push(request);
        return options.token;
      },
      webSocket: (url, protocols) => {
        const socket = new FakeSocket(url, protocols);
        Queue.offerUnsafe(sockets, socket);
        return socket;
      },
      network: network.signal,
    });
    const nextSocket = Effect.gen(function* () {
      yield* settle;
      const socket = yield* Queue.take(sockets);
      socket.open();
      yield* settle;
      return socket;
    });
    const noSocket = Effect.gen(function* () {
      yield* settle;
      return Option.isNone(yield* Queue.poll(sockets));
    });
    return { store, owned, nextSocket, noSocket, tokenRequests, pulls, network };
  });

describe("live socket transport", () => {
  it("derives the socket URL and the token expiry", () => {
    expect(liveSocketUrl("https://api.tabaaq.test/", "replica-1", undefined)).toBe(
      "wss://api.tabaaq.test/api/sync/live?replicaId=replica-1",
    );
    expect(liveSocketUrl("http://localhost:8787/api", "replica-1", 262_144)).toBe(
      "ws://localhost:8787/api/sync/live?replicaId=replica-1&maxBytes=262144",
    );
    expect(accessTokenExpiresAt(tokenExpiringAt(1_800_000))).toBe(1_800_000);
    expect(accessTokenExpiresAt("not-a-token")).toBeUndefined();
  });

  it.effect("carries the bearer token in the subprotocol and pulls when hello is ahead", () =>
    Effect.gen(function* () {
      const token = tokenExpiringAt(60 * 60_000);
      const live = yield* startLive({ token });
      const socket = yield* live.nextSocket;
      expect(socket.url).toBe("wss://api.tabaaq.test/api/sync/live?replicaId=replica-1");
      expect(socket.protocols).toEqual([LIVE_SOCKET_PROTOCOL, `bearer.${token}`]);
      const before = yield* Ref.get(live.pulls);
      socket.message(`{"_tag":"hello","epoch":"${LAST_UNIT_EPOCH}","horizon":"3"}`);
      yield* settle;
      expect(yield* Ref.get(live.pulls)).toBe(before + 1);
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );

  it.effect("reconnects before the access token expires", () =>
    Effect.gen(function* () {
      const live = yield* startLive({ token: tokenExpiringAt(10 * 60_000) });
      const first = yield* live.nextSocket;
      yield* TestClock.adjust("7 minutes");
      expect(first.closedWith).toBeUndefined();
      yield* TestClock.adjust("1 minute");
      const second = yield* live.nextSocket;
      expect(first.closedWith).toBe(1000);
      expect(second.closedWith).toBeUndefined();
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );

  it.effect("backs off and reconnects after the socket drops", () =>
    Effect.gen(function* () {
      const live = yield* startLive({ token: tokenExpiringAt(60 * 60_000) });
      const first = yield* live.nextSocket;
      first.drop(1006);
      expect(yield* live.noSocket).toBe(true);
      yield* TestClock.adjust("2 seconds");
      const second = yield* live.nextSocket;
      expect(second.url).toBe(first.url);
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );

  it.effect("drops the socket while offline and reconnects as soon as the network returns", () =>
    Effect.gen(function* () {
      const live = yield* startLive({ token: tokenExpiringAt(60 * 60_000) });
      const first = yield* live.nextSocket;
      live.network.set(false);
      yield* settle;
      expect(first.closedWith).toBe(1000);
      yield* TestClock.adjust("5 minutes");
      expect(yield* live.noSocket).toBe(true);
      live.network.set(true);
      yield* live.nextSocket;
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );

  it.effect("refreshes the token after the hub revokes the socket", () =>
    Effect.gen(function* () {
      const live = yield* startLive({ token: tokenExpiringAt(60 * 60_000) });
      const first = yield* live.nextSocket;
      first.drop(LIVE_SOCKET_CLOSE.revoked);
      yield* TestClock.adjust("2 seconds");
      yield* live.nextSocket;
      expect(live.tokenRequests.map((request) => request.force)).toEqual([false, true]);
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );

  it.effect("closes a socket that stops answering pings", () =>
    Effect.gen(function* () {
      const live = yield* startLive({ token: tokenExpiringAt(60 * 60_000) });
      const first = yield* live.nextSocket;
      first.send = (data) => {
        first.sent.push(data instanceof Uint8Array ? "" : data);
      };
      yield* TestClock.adjust("41 seconds");
      yield* settle;
      expect(first.sent).toContain(LIVE_SOCKET_PING);
      expect(first.closedWith).toBe(1000);
      yield* live.owned.dispose;
      yield* live.store.dispose();
    }),
  );
});
