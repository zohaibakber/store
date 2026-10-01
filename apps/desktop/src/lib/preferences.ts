import * as Schema from "effect/Schema";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import * as Atom from "effect/unstable/reactivity/Atom";

import { initialSaleDrafts, SaleDrafts } from "@/lib/sale-drafts";

export const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const THEME_KEY = "store-electron-theme";

const upgradeBareThemePreference = (storage: Storage) => {
  const stored = storage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") {
    storage.setItem(THEME_KEY, JSON.stringify(stored));
  }
};

export const preferenceStore = () => {
  const storage = browserStorage();
  if (storage === null) return KeyValueStore.layerMemory;
  upgradeBareThemePreference(storage);
  return KeyValueStore.layerStorage(() => storage);
};

const preferencesRuntime = Atom.runtime(() => preferenceStore());

export const ThemePreferenceSchema = Schema.Literals(["dark", "light", "system"]);
export type ThemePreference = typeof ThemePreferenceSchema.Type;

export const themePreferenceAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: THEME_KEY,
  schema: ThemePreferenceSchema,
  defaultValue: (): ThemePreference => "dark",
}).pipe(Atom.keepAlive);

export const sidebarOpenAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.sidebar-open",
  schema: Schema.Boolean,
  defaultValue: () => false,
}).pipe(Atom.keepAlive);

export const RecentProductSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  strength: Schema.NullOr(Schema.String),
  categoryName: Schema.String,
});

export type RecentProduct = typeof RecentProductSchema.Type;

export const recentProductsAtom = Atom.family((workspace: string) =>
  Atom.kvs({
    runtime: preferencesRuntime,
    key: `store.recent-products.${workspace}`,
    schema: Schema.Array(RecentProductSchema),
    defaultValue: (): ReadonlyArray<RecentProduct> => [],
  }).pipe(Atom.keepAlive),
);

export const saleDraftsAtom = Atom.family((workspace: string) =>
  Atom.kvs({
    runtime: preferencesRuntime,
    key: `store.sale-drafts.${workspace}`,
    schema: SaleDrafts,
    defaultValue: initialSaleDrafts,
  }).pipe(Atom.keepAlive),
);

export const publishOfferDismissedAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.publish-offer-dismissed",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
}).pipe(Atom.keepAlive);

export const acknowledgedRejectionsAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.acknowledged-rejections",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
}).pipe(Atom.keepAlive);
