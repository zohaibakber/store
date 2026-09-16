import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ReplicaWorkerRequest, ReplicaWorkerResponse } from "./wa-sqlite-protocol";
import { openWaSqliteSession, type WaSqliteSession } from "./wa-sqlite-session";

const RequestId = Schema.Struct({
  requestId: Schema.Number,
});

let session: WaSqliteSession | undefined;

const reply = (response: ReplicaWorkerResponse): void => {
  self.postMessage(response);
};

const handle = async (request: ReplicaWorkerRequest): Promise<void> => {
  switch (request._tag) {
    case "open": {
      session = await openWaSqliteSession(request.databaseName, "idb");
      reply({ _tag: "ok", requestId: request.requestId });
      return;
    }
    case "query": {
      const open = session;
      if (!open) {
        reply({
          _tag: "error",
          requestId: request.requestId,
          message: "Replica SQLite worker is not open.",
        });
        return;
      }
      const rows = await open.query(request.sql, request.parameters);
      reply({ _tag: "rows", requestId: request.requestId, rows });
      return;
    }
    case "close": {
      const open = session;
      session = undefined;
      await open?.close();
      reply({ _tag: "ok", requestId: request.requestId });
    }
  }
};

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const requestId = Schema.decodeUnknownOption(RequestId)(event.data);
  const request = Schema.decodeUnknownOption(ReplicaWorkerRequest)(event.data);
  if (Option.isNone(request)) {
    if (Option.isSome(requestId)) {
      reply({
        _tag: "error",
        requestId: requestId.value.requestId,
        message: "Replica SQLite worker received an invalid request.",
      });
    }
    return;
  }
  void handle(request.value).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "Replica SQLite worker failed.";
    reply({ _tag: "error", requestId: request.value.requestId, message });
  });
});
