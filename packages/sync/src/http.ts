import {
  CatalogPullRequest,
  CatalogPullResult,
  CatalogSnapshotRequest,
  CatalogSnapshotResult,
  CatalogWriteCommand,
  ImportInventoryCommand,
  ImportInventoryCommandResult,
  IssueInvoiceCommand,
  IssueInvoiceResult,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CatalogError } from "./errors";
import { CatalogTransport } from "./transport";

type CatalogJson = typeof Schema.Json.Type;
type CatalogRequestBody =
  | CatalogPullRequest
  | CatalogSnapshotRequest
  | CatalogWriteCommand
  | IssueInvoiceCommand
  | ImportInventoryCommand;

const decodeJson = <A, I>(schema: Schema.Codec<A, I>, body: CatalogJson) =>
  Schema.decodeUnknownEffect(schema)(body).pipe(
    Effect.mapError(
      (cause) =>
        new CatalogError({
          reason: "rejected",
          message: cause.message,
        }),
    ),
  );

const requestHeaders = (headers: HeadersInit) => {
  const next = new Headers(headers);
  next.set("content-type", "application/json");
  return next;
};

const requestJson = Effect.fn("CatalogTransport.request")(function* (
  url: URL,
  headers: HeadersInit,
  body: CatalogRequestBody,
  fetchImpl: typeof fetch,
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetchImpl(url, {
        method: "POST",
        headers: requestHeaders(headers),
        body: JSON.stringify(body),
      }),
    catch: (cause) => new CatalogError({ reason: "transport", message: String(cause) }),
  });
  const payload = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new CatalogError({ reason: "rejected", message: String(cause) }),
  });
  if (!response.ok) {
    const reason =
      response.status === 401
        ? ("unauthenticated" as const)
        : response.status === 409
          ? ("conflict" as const)
          : response.status >= 500
            ? ("transient" as const)
            : response.status >= 400
              ? ("rejected" as const)
              : ("transport" as const);
    return yield* new CatalogError({
      reason,
      message: `catalog ${String(response.status)}`,
    });
  }
  return yield* Schema.decodeUnknownEffect(Schema.Json)(payload).pipe(
    Effect.mapError(
      (cause) =>
        new CatalogError({
          reason: "rejected",
          message: cause.message,
        }),
    ),
  );
});

export const CatalogHttpTransport = (options: {
  readonly apiUrl: string;
  readonly headers: () => HeadersInit;
  readonly fetch?: typeof fetch;
}) => {
  const fetchImpl = options.fetch ?? fetch;
  return Layer.succeed(
    CatalogTransport,
    CatalogTransport.of({
      pull: Effect.fn("CatalogTransport.pull")(function* (request: CatalogPullRequest) {
        const payload = yield* requestJson(
          new URL("/api/inventory/pull", options.apiUrl),
          options.headers(),
          request,
          fetchImpl,
        );
        return yield* decodeJson(CatalogPullResult, payload);
      }),
      snapshot: Effect.fn("CatalogTransport.snapshot")(function* (request: CatalogSnapshotRequest) {
        const payload = yield* requestJson(
          new URL("/api/inventory/snapshot", options.apiUrl),
          options.headers(),
          request,
          fetchImpl,
        );
        return yield* decodeJson(CatalogSnapshotResult, payload);
      }),
      write: Effect.fn("CatalogTransport.write")(function* (command: CatalogWriteCommand) {
        const payload = yield* requestJson(
          new URL("/api/inventory/mutations", options.apiUrl),
          options.headers(),
          command,
          fetchImpl,
        );
        return yield* decodeJson(
          Schema.Struct({
            txid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
          }),
          payload,
        );
      }),
      issueInvoice: Effect.fn("CatalogTransport.issueInvoice")(function* (
        command: IssueInvoiceCommand,
      ) {
        const payload = yield* requestJson(
          new URL("/api/inventory/invoices", options.apiUrl),
          options.headers(),
          command,
          fetchImpl,
        );
        return yield* decodeJson(IssueInvoiceResult, payload);
      }),
      importInventory: Effect.fn("CatalogTransport.importInventory")(function* (
        command: ImportInventoryCommand,
      ) {
        const payload = yield* requestJson(
          new URL("/api/inventory/imports", options.apiUrl),
          options.headers(),
          command,
          fetchImpl,
        );
        return yield* decodeJson(ImportInventoryCommandResult, payload);
      }),
    }),
  );
};
