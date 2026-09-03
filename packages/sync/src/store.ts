import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { KeyValueStore } from "effect/unstable/persistence"

export interface DurableStoreApi {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class DurableStore extends Context.Service<DurableStore, DurableStoreApi>()(
  "store/DurableStore",
) {
  static fromKeyValueStore = Layer.effect(
    DurableStore,
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore
      return DurableStore.of({
        get: (key) => kv.get(key).pipe(Effect.orDie),
        set: (key, value) => kv.set(key, value).pipe(Effect.orDie),
        remove: (key) => kv.remove(key).pipe(Effect.orDie),
      })
    }),
  )

  static memory = DurableStore.fromKeyValueStore.pipe(Layer.provide(KeyValueStore.layerMemory))
}
