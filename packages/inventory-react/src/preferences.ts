import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import { runtime } from "./services";

export const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const preferenceStore = Layer.unwrap(
  Effect.sync(() => {
    const storage = browserStorage();
    return storage === null ? KeyValueStore.layerMemory : KeyValueStore.layerStorage(() => storage);
  }),
);

export const preferencesRuntime = runtime(preferenceStore);
