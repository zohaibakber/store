import { SyncProtocolCode } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import { databaseError, protocol, runStatement } from "./postgres";

export const syncFunctionReply = {
  body: Schema.NullOr(Schema.String),
  error_code: Schema.NullOr(SyncProtocolCode),
  error_message: Schema.NullOr(Schema.String),
};

interface SyncFunctionReply {
  readonly body: string | null;
  readonly error_code: SyncProtocolCode | null;
  readonly error_message: string | null;
}

const hasBody = <Reply extends SyncFunctionReply>(
  reply: Reply,
): reply is Reply & { readonly body: string } => reply.body !== null;

export const answered = <Reply extends SyncFunctionReply>(
  reply: Reply,
): Effect.Effect<Reply & { readonly body: string }, InventoryError> =>
  reply.error_code !== null
    ? protocol(reply.error_code, reply.error_message ?? reply.error_code)
    : hasBody(reply)
      ? Effect.succeed(reply)
      : Effect.fail(databaseError(new Error("The sync function returned no body.")));

export const syncFunctionRow = <Row>(row: Schema.Codec<Row, unknown>) => {
  const decode = Schema.decodeUnknownEffect(Schema.Tuple([row]));
  return <E>(statement: Effect.Effect<unknown, E>) =>
    runStatement(statement).pipe(
      Effect.flatMap((rows) => Effect.mapError(decode(rows), databaseError)),
      Effect.map(([only]) => only),
    );
};

const replyRow = syncFunctionRow(Schema.Struct(syncFunctionReply));

export const syncFunctionJson = <E>(statement: Effect.Effect<unknown, E>) =>
  replyRow(statement).pipe(
    Effect.flatMap(answered),
    Effect.map((reply) => reply.body),
  );

export const actorJson = (actor: InventoryActor) =>
  JSON.stringify({ organizationId: actor.organizationId, userId: actor.userId });
