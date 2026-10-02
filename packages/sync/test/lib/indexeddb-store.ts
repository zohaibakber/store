import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import {
  IndexedDbReplicaStore,
  layerIndexedDbReplicaStore,
} from "../../src/replica/indexeddb/store";

export const makeIndexedDbReplicaStore = (
  input: Parameters<typeof layerIndexedDbReplicaStore>[0],
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const close = Scope.close(scope, Exit.void);
    const context = yield* Layer.buildWithScope(layerIndexedDbReplicaStore(input), scope).pipe(
      Effect.onError(() => close),
    );
    return { ...Context.get(context, IndexedDbReplicaStore), dispose: () => close };
  });
