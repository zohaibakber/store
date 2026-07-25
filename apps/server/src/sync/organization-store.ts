import { SyncRequest, SyncResponse } from "@store/contracts";
import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";

import { SyncDatabaseError, SyncProtocolCode, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

// Schema classes and typed errors do not survive structured clone.
export const SyncExchangePayload = Schema.Struct({
  actor: Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
  request: SyncRequest,
});

export const SyncExchangeResult = Schema.Union([
  Schema.TaggedStruct("Success", { response: SyncResponse }),
  Schema.TaggedStruct("ProtocolFailure", { code: SyncProtocolCode, message: Schema.String }),
  Schema.TaggedStruct("DatabaseFailure", { message: Schema.String }),
]);

const decodePayload = Schema.decodeUnknownSync(SyncExchangePayload);
const encodeResult = Schema.encodeSync(SyncExchangeResult);

export class OrganizationStore extends DurableObject<Env> {
  readonly #runtime = makeSyncRuntime(this.ctx.storage);

  override async fetch(request: Request): Promise<Response> {
    const payload = decodePayload(await request.json());
    try {
      const response = await this.#runtime.runSync(payload.actor, payload.request);
      return Response.json(encodeResult({ _tag: "Success", response }));
    } catch (cause) {
      if (cause instanceof SyncProtocolError)
        return Response.json(
          encodeResult({ _tag: "ProtocolFailure", code: cause.code, message: cause.message }),
        );
      const message = cause instanceof Error ? cause.message : String(cause);
      return Response.json(encodeResult({ _tag: "DatabaseFailure", message }));
    }
  }
}

const decodeResult = Schema.decodeUnknownSync(SyncExchangeResult);
const encodePayload = Schema.encodeSync(SyncExchangePayload);

export const exchangeWithOrganizationStore = async (
  namespace: DurableObjectNamespace<OrganizationStore>,
  actor: SyncActor,
  request: SyncRequest,
): Promise<SyncResponse> => {
  const stub = namespace.getByName(actor.organizationId);
  const response = await stub.fetch("https://organization-store/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(encodePayload({ actor, request })),
  });
  const result = decodeResult(await response.json());
  if (result._tag === "ProtocolFailure")
    throw SyncProtocolError.make({ code: result.code, message: result.message });
  if (result._tag === "DatabaseFailure") throw SyncDatabaseError.make({ message: result.message });
  return result.response;
};
