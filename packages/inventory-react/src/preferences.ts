import type * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as Atom from "effect/unstable/reactivity/Atom";

let preferenceStore: Layer.Layer<KeyValueStore.KeyValueStore> = KeyValueStore.layerMemory;

export const configureInventoryPreferences = (store: Layer.Layer<KeyValueStore.KeyValueStore>) => {
  preferenceStore = store;
};

export const preferencesRuntime = Atom.runtime(() => preferenceStore);
