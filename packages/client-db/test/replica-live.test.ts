import type { CommandReceipt, SyncLiveServerFrame } from "@store/contracts";
import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { describe, expect, it } from "vitest";

import {
  connectOrganizationObjectLiveTransport,
  type OrganizationObjectLiveSocket,
  type OrganizationObjectLiveSocketHandlers,
  type ReplicaLiveFeed,
} from "../src/replica/live";

const nonce = "ab".repeat(32);

const ticket = {
  nonce,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  subscription: "operational" as const,
  expiresAt: 1_700_000_030_000,
};

const transactionsFrame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }> = {
  _tag: "transactions",
  epoch: lastUnitBuyerAEnvelope.epoch,
  subscription: "operational",
  schemaVersion: 1,
  fromCommitSequence: OrgCommitSequence.make("3"),
  toCommitSequence: OrgCommitSequence.make("3"),
  transactions: [
    {
      commitSequence: OrgCommitSequence.make("3"),
      operationId: "operation-stale-live",
      decision: "accepted",
      changes: [
        {
          entity: "batch",
          action: "upsert",
          entityId: LAST_UNIT_BATCH_ID,
          rowVersion: 3,
          row: {
            id: LAST_UNIT_BATCH_ID,
            productId: LAST_UNIT_PRODUCT_ID,
            packQuantity: 0,
            unitQuantity: 3,
          },
        },
      ],
    },
  ],
};

type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly authorization: string | null;
};

const mintFetch =
  (requests: Array<RecordedRequest>): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      body: await request.text(),
      authorization: request.headers.get("authorization"),
    });
    return new Response(JSON.stringify(ticket), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

const createSocket = () => {
  const urls: Array<string> = [];
  const sent: Array<string> = [];
  let handlers: OrganizationObjectLiveSocketHandlers | undefined;
  let open = true;
  const socket: OrganizationObjectLiveSocket & {
    readonly deliver: (data: string) => void;
  } = {
    send: (data) => {
      sent.push(data);
    },
    close: () => {
      open = false;
    },
    isOpen: () => open,
    deliver: (data) => {
      handlers?.onMessage(data);
    },
  };
  return {
    urls,
    sent,
    socket,
    openSocket: (url: string, next: OrganizationObjectLiveSocketHandlers) => {
      urls.push(url);
      handlers = next;
      return socket;
    },
  };
};

describe("connectOrganizationObjectLiveTransport", () => {
  it("does not apply a live frame while the feed is catching up, then applies the same frame while following", async () => {
    const requests: Array<RecordedRequest> = [];
    const applied: Array<SyncLiveServerFrame> = [];
    let feed: ReplicaLiveFeed = { _tag: "catchingUp", targetCommitSequence: "5" };
    const { socket, openSocket } = createSocket();
    await connectOrganizationObjectLiveTransport(
      mintFetch(requests),
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      {
        feed: () => feed,
        appliedCursor: () => "5",
        applyTransactions: (frame) => {
          applied.push(frame);
          return true;
        },
        applyReceipt: () => undefined,
        resumeFromCursor: () => undefined,
      },
      openSocket,
    );
    socket.deliver(JSON.stringify(transactionsFrame));
    expect(applied).toEqual([]);
    feed = { _tag: "following" };
    socket.deliver(JSON.stringify(transactionsFrame));
    expect(applied).toEqual([transactionsFrame]);
  });

  it("resumes from the persisted cursor when a live frame cannot be decoded", async () => {
    const requests: Array<RecordedRequest> = [];
    const applied: Array<SyncLiveServerFrame> = [];
    const resumes: Array<string> = [];
    const { socket, openSocket } = createSocket();
    await connectOrganizationObjectLiveTransport(
      mintFetch(requests),
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      {
        feed: () => ({ _tag: "following" }),
        appliedCursor: () => "12",
        applyTransactions: (frame) => {
          applied.push(frame);
          return true;
        },
        applyReceipt: () => undefined,
        resumeFromCursor: (cursor) => {
          resumes.push(cursor);
        },
      },
      openSocket,
    );
    socket.deliver("{");
    socket.deliver(JSON.stringify({ hello: 1 }));
    expect(applied).toEqual([]);
    expect(resumes).toEqual(["12", "12"]);
  });

  it("mints a ticket through authenticated fetch and opens a nonce socket without a refresh token", async () => {
    const requests: Array<RecordedRequest> = [];
    const { urls, openSocket } = createSocket();
    await connectOrganizationObjectLiveTransport(
      mintFetch(requests),
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      {
        feed: () => ({ _tag: "following" }),
        appliedCursor: () => "0",
        applyTransactions: () => false,
        applyReceipt: (_receipt: CommandReceipt) => undefined,
        resumeFromCursor: () => undefined,
      },
      openSocket,
    );
    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/live-tickets",
        method: "POST",
        body: JSON.stringify({
          replicaId: "replica-a",
          subscription: "operational",
        }),
        authorization: null,
      },
    ]);
    expect(urls).toEqual([
      `wss://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    ]);
    expect(urls[0]?.includes("refresh")).toBe(false);
    expect(urls[0]?.includes("Bearer")).toBe(false);
  });

  it("resumes from the persisted cursor when the server reports a lost send window", async () => {
    const requests: Array<RecordedRequest> = [];
    const resumes: Array<string> = [];
    const { socket, openSocket } = createSocket();
    await connectOrganizationObjectLiveTransport(
      mintFetch(requests),
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      {
        feed: () => ({ _tag: "following" }),
        appliedCursor: () => "12",
        applyTransactions: () => true,
        applyReceipt: () => undefined,
        resumeFromCursor: (cursor) => {
          resumes.push(cursor);
        },
      },
      openSocket,
    );
    socket.deliver(
      JSON.stringify({
        _tag: "resume",
        epoch: "1",
        reason: "send_window_lost",
        fromCommitSequence: "99",
      }),
    );
    expect(resumes).toEqual(["12"]);
  });
});
