import { SyncTransport } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const UnreachableTransport = Layer.mock(SyncTransport, {
  registerReplica: () => Effect.never,
  submitCommand: () => Effect.never,
  getReceipt: () => Effect.never,
  pull: () => Effect.never,
  acquireSnapshot: () => Effect.never,
  readSnapshotPart: () => Effect.never,
});
