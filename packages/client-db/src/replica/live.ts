import {
  CommandReceipt,
  LiveTicket,
  LiveTicketRequest,
  OPERATIONAL_SUBSCRIPTION,
  SyncLiveClientFrame,
  SyncLiveServerFrame,
} from "@store/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { inventoryApiRoot, inventoryRequest } from "../mutations";

export type ReplicaLiveFeed =
  | {
      readonly _tag: "catchingUp";
      readonly targetCommitSequence: string;
    }
  | {
      readonly _tag: "following";
    };

export type OrganizationObjectLiveSocket = {
  readonly send: (data: string) => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
};

export type OrganizationObjectLiveSocketHandlers = {
  readonly onMessage: (data: string) => void;
  readonly onClose: () => void;
  readonly onError: () => void;
};

export type OpenOrganizationObjectLiveSocket = (
  url: string,
  handlers: OrganizationObjectLiveSocketHandlers,
) => OrganizationObjectLiveSocket;

export type OrganizationObjectLiveEngine = {
  readonly feed: () => ReplicaLiveFeed;
  readonly appliedCursor: () => string;
  readonly applyTransactions: (
    frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
  ) => boolean | Promise<boolean>;
  readonly applyReceipt: (receipt: CommandReceipt) => void;
  readonly resumeFromCursor: (cursor: string) => void;
};

export type OrganizationObjectLiveTransport = {
  readonly close: () => void;
};

const decodeLiveFrame = Schema.decodeUnknownOption(Schema.fromJsonString(SyncLiveServerFrame));

const liveSocketUrl = (
  apiBaseUrl: string,
  nonce: string,
  replicaId: string,
  subscription: typeof OPERATIONAL_SUBSCRIPTION,
): string => {
  const live = new URL(`${inventoryApiRoot(apiBaseUrl)}/sync/live`);
  live.protocol = live.protocol === "https:" ? "wss:" : "ws:";
  live.searchParams.set("nonce", nonce);
  live.searchParams.set("replicaId", replicaId);
  live.searchParams.set("subscription", subscription);
  return live.href;
};

const acknowledgeTransactions = (
  socket: OrganizationObjectLiveSocket,
  engine: OrganizationObjectLiveEngine,
  frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
): void => {
  if (!socket.isOpen()) {
    engine.resumeFromCursor(engine.appliedCursor());
    return;
  }
  try {
    socket.send(
      JSON.stringify(
        Schema.encodeSync(SyncLiveClientFrame)({
          _tag: "acknowledge",
          throughCommitSequence: frame.toCommitSequence,
        }),
      ),
    );
  } catch {
    engine.resumeFromCursor(engine.appliedCursor());
  }
};

const afterTransactionsApplied = (
  applied: boolean | Promise<boolean>,
  socket: OrganizationObjectLiveSocket,
  engine: OrganizationObjectLiveEngine,
  frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
): void => {
  if (applied === true) {
    acknowledgeTransactions(socket, engine, frame);
    return;
  }
  if (applied === false) return;
  void applied.then((ok) => {
    if (ok) acknowledgeTransactions(socket, engine, frame);
  });
};

const handleLiveFrame = (
  data: string,
  socket: OrganizationObjectLiveSocket,
  engine: OrganizationObjectLiveEngine,
): void => {
  const decoded = decodeLiveFrame(data);
  if (Option.isNone(decoded)) {
    engine.resumeFromCursor(engine.appliedCursor());
    return;
  }
  const frame = decoded.value;
  switch (frame._tag) {
    case "transactions": {
      if (engine.feed()._tag !== "following") return;
      afterTransactionsApplied(engine.applyTransactions(frame), socket, engine, frame);
      return;
    }
    case "receipt": {
      if (engine.feed()._tag !== "following") return;
      engine.applyReceipt(frame.receipt);
      return;
    }
    case "resume": {
      engine.resumeFromCursor(engine.appliedCursor());
    }
  }
};

export const openBrowserOrganizationObjectLiveSocket = (
  url: string,
  handlers: OrganizationObjectLiveSocketHandlers,
): OrganizationObjectLiveSocket => {
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    if (Schema.is(Schema.String)(event.data)) handlers.onMessage(event.data);
  });
  socket.addEventListener("close", () => {
    handlers.onClose();
  });
  socket.addEventListener("error", () => {
    handlers.onError();
  });
  return {
    send: (data) => {
      socket.send(data);
    },
    close: () => {
      socket.close();
    },
    isOpen: () => socket.readyState === WebSocket.OPEN,
  };
};

export const connectOrganizationObjectLiveTransport = async (
  authenticatedFetch: typeof fetch,
  apiBaseUrl: string,
  replicaId: string,
  engine: OrganizationObjectLiveEngine,
  openSocket: OpenOrganizationObjectLiveSocket,
): Promise<OrganizationObjectLiveTransport> => {
  const ticket = await inventoryRequest({
    apiBaseUrl,
    authenticatedFetch,
    path: "/sync/live-tickets",
    body: Schema.encodeSync(LiveTicketRequest)({
      replicaId,
      subscription: OPERATIONAL_SUBSCRIPTION,
    }),
    decode: Schema.decodeUnknownSync(LiveTicket),
    failureLabel: "Live ticket mint failed.",
  });
  let socket: OrganizationObjectLiveSocket | undefined;
  socket = openSocket(liveSocketUrl(apiBaseUrl, ticket.nonce, replicaId, ticket.subscription), {
    onMessage: (data) => {
      if (socket === undefined) return;
      handleLiveFrame(data, socket, engine);
    },
    onClose: () => undefined,
    onError: () => undefined,
  });
  return {
    close: () => {
      socket?.close();
    },
  };
};
