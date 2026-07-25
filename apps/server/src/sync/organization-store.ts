import { SyncRequest, SyncResponse } from "@store/contracts";
import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";

import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

/**
 * What crosses the Worker → Durable Object boundary.
 *
 * A Durable Object is a separate process, so this is a real serialization
 * boundary and gets the same treatment as the HTTP one: encoded plain data only.
 * `SyncRequest`/`SyncResponse` are `Schema.Class` instances and typed errors are
 * `Schema.TaggedErrorClass` instances — neither survives structured clone, and
 * `routes/sync.ts` maps failures to HTTP status by class, so failures are
 * carried as data and rebuilt on the far side.
 */
export const SyncExchangePayload = Schema.Struct({
  actor: Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
  request: SyncRequest,
});

export const SyncExchangeResult = Schema.Union([
  Schema.TaggedStruct("Success", { response: SyncResponse }),
  Schema.TaggedStruct("ProtocolFailure", { code: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("DatabaseFailure", { message: Schema.String }),
]);

const decodePayload = Schema.decodeUnknownSync(SyncExchangePayload);
const encodeResult = Schema.encodeSync(SyncExchangeResult);

/**
 * One Durable Object per organization, holding that organization's synced store
 * in its own SQLite database.
 *
 * The sharding key is `organizationId`, which every query in the sync path
 * already filters by. Because a Durable Object handles one request at a time and
 * owns its storage exclusively, this also removes the need for the advisory lock
 * and the row locks the Postgres implementation used.
 */
export class OrganizationStore extends DurableObject<Env> {
  // Built once per object rather than per request. The Effect layer memoises,
  // so migrations run on the first exchange and not again; rebuilding per
  // request would re-run the migrator every time.
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

/** Invokes an organization's Durable Object and restores typed failures. */
export const exchangeWithOrganizationStore = async (
  namespace: DurableObjectNamespace<OrganizationStore>,
  actor: SyncActor,
  request: SyncRequest,
): Promise<SyncResponse> => {
  const stub = namespace.getByName(actor.organizationId);
  // The URL is required by the Request constructor but never routed on; the
  // stub already identifies the target object.
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
