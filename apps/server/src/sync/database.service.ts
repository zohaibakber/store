import type { SyncRequest, SyncResponse } from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";

export class SyncDatabase extends Context.Service<
  SyncDatabase,
  {
    readonly exchange: (
      actor: SyncActor,
      request: SyncRequest,
    ) => Effect.Effect<SyncResponse, SyncDatabaseError | SyncProtocolError>;
  }
>()("@store/server/SyncDatabase") {}
