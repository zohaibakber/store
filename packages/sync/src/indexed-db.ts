import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { KeyValueStore } from "effect/unstable/persistence";

const STORE = "kv";

const openDatabase = (name: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
      }),
    catch: (cause) => cause,
  });

const requestToEffect = <T>(run: () => IDBRequest<T>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<T>((resolve, reject) => {
        const request = run();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
      }),
    catch: (cause) => cause,
  });

export const layerIndexedDb = (name: string) =>
  Layer.effect(
    KeyValueStore.KeyValueStore,
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(openDatabase(name), (handle) =>
        Effect.sync(() => handle.close()),
      );
      return KeyValueStore.makeStringOnly({
        get: (key) =>
          requestToEffect(() => db.transaction(STORE, "readonly").objectStore(STORE).get(key)).pipe(
            Effect.map((value) =>
              Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrUndefined),
            ),
            Effect.orDie,
          ),
        set: (key, value) =>
          requestToEffect(() =>
            db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key),
          ).pipe(Effect.asVoid, Effect.orDie),
        remove: (key) =>
          requestToEffect(() =>
            db.transaction(STORE, "readwrite").objectStore(STORE).delete(key),
          ).pipe(Effect.asVoid, Effect.orDie),
        clear: requestToEffect(() =>
          db.transaction(STORE, "readwrite").objectStore(STORE).clear(),
        ).pipe(Effect.asVoid, Effect.orDie),
        size: requestToEffect(() =>
          db.transaction(STORE, "readonly").objectStore(STORE).count(),
        ).pipe(Effect.orDie),
      });
    }),
  );
