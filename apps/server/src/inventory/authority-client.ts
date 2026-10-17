import { syncProtocolError } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { AuthorityReply, OrgAuthorityApi } from "../authority/facade";
import { InventoryDatabaseError, SyncRequestMalformed, type InventoryError } from "./errors";

export interface AuthorityNamespace<R = never, E = never> {
  readonly getByName: (organizationId: string) => OrgAuthorityApi<R, E>;
}

const unreachable = <E>(cause: E) =>
  InventoryDatabaseError.make({
    message: cause instanceof Error ? cause.message : "The inventory authority is unavailable.",
    cause,
  });

const settle = <A>(
  reply: AuthorityReply<A>,
): Effect.Effect<A, InventoryError | SyncRequestMalformed> => {
  switch (reply._tag) {
    case "ok":
      return Effect.succeed(reply.value);
    case "refused":
      return Effect.fail(syncProtocolError(reply.code, reply.message));
    case "malformed":
      return Effect.fail(SyncRequestMalformed.make({ message: reply.message }));
  }
};

export const answeredOrMalformed = <A, E, R>(
  reply: Effect.Effect<AuthorityReply<A>, E, R>,
): Effect.Effect<A, InventoryError | SyncRequestMalformed, R> =>
  reply.pipe(Effect.mapError(unreachable), Effect.flatMap(settle));

export const answered = <A, E, R>(
  reply: Effect.Effect<AuthorityReply<A>, E, R>,
): Effect.Effect<A, InventoryError, R> =>
  answeredOrMalformed(reply).pipe(
    Effect.catchTag("SyncRequestMalformed", (malformed) =>
      Effect.fail(InventoryDatabaseError.make({ message: malformed.message })),
    ),
  );
