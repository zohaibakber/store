import { SyncEngine, SyncStateRef } from "@store/sync";
import * as Layer from "effect/Layer";

export const freshSyncEngine = () =>
  SyncEngine.layer().pipe(Layer.provide(Layer.fresh(SyncStateRef.layer)));
