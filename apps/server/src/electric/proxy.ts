import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { publicError } from "../http/errors";

export const ELECTRIC_REPLICA_TABLES = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
] as const;
export type ElectricReplicaTable = (typeof ELECTRIC_REPLICA_TABLES)[number];

export type ElectricProxyConfig =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "enabled";
      readonly baseUrl: string;
      readonly sourceId: string | undefined;
      readonly sourceSecret: Redacted.Redacted<string> | undefined;
    };

export interface ElectricProxyInput {
  readonly table: ElectricReplicaTable;
  readonly organizationId: string;
  readonly request: Request;
}

const upstreamUrl = (
  config: Extract<ElectricProxyConfig, { readonly kind: "enabled" }>,
  input: ElectricProxyInput,
) => {
  const requestUrl = new URL(input.request.url);
  const url = new URL("/v1/shape", config.baseUrl);

  requestUrl.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) url.searchParams.set(key, value);
  });

  url.searchParams.set("table", input.table);
  url.searchParams.set("where", '"organization_id" = $1');
  url.searchParams.set("params[1]", input.organizationId);
  if (config.sourceId) url.searchParams.set("source_id", config.sourceId);
  if (config.sourceSecret) url.searchParams.set("secret", Redacted.value(config.sourceSecret));

  return url;
};

export const makeElectricProxy = (
  config: ElectricProxyConfig,
  fetchUpstream: typeof fetch = fetch,
) =>
  Effect.fn("ElectricProxy.proxy")(function* (input: ElectricProxyInput) {
    if (config.kind === "disabled")
      return HttpServerResponse.jsonUnsafe(
        publicError("ELECTRIC_NOT_CONFIGURED", "Electric sync is not configured."),
        { status: 503 },
      );

    const response = yield* Effect.tryPromise({
      try: () => fetchUpstream(upstreamUrl(config, input), { signal: input.request.signal }),
      catch: () => undefined,
    }).pipe(Effect.option);

    if (response._tag === "None")
      return HttpServerResponse.jsonUnsafe(
        publicError("ELECTRIC_UNAVAILABLE", "Electric sync is temporarily unavailable."),
        { status: 502 },
      );

    const headers = new Headers(response.value.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("vary", "Authorization");

    return HttpServerResponse.fromWeb(
      new Response(response.value.body, {
        status: response.value.status,
        statusText: response.value.statusText,
        headers,
      }),
    );
  });
