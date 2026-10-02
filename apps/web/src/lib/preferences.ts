import { decodeInvoiceId, type InvoiceId } from "@store/contracts/ids";
import * as Option from "effect/Option";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Atom from "effect/reactivity/Atom";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

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

const ThemePreferenceSchema = Schema.Literals(["dark", "light", "system"]);
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

const RecentProductSchema = Schema.Struct({
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

type Held<A> = { readonly text: string | null; readonly value: A };

const sharedAtom = <A, I>(options: {
  readonly key: string;
  readonly schema: Schema.Codec<A, I>;
  readonly defaultValue: () => A;
}): Atom.Writable<A, (current: A) => A> => {
  const json = Schema.fromJsonString(Schema.toCodecJson(options.schema));
  const decode = Schema.decodeUnknownOption(json);
  const encode = Schema.encodeOption(json);
  const storedText = () => browserStorage()?.getItem(options.key) ?? null;

  const persist = (value: A): Held<A> => {
    const storage = browserStorage();
    const text = Option.getOrNull(encode(value));
    if (storage !== null && text !== null) Result.try(() => storage.setItem(options.key, text));
    return { text: storedText(), value };
  };

  const latest = (held: Option.Option<Held<A>>): Held<A> => {
    const text = storedText();
    if (Option.isSome(held) && held.value.text === text) return held.value;
    return Option.fromNullishOr(text).pipe(
      Option.flatMap(decode),
      Option.match({
        onNone: () => persist(options.defaultValue()),
        onSome: (value) => ({ text, value }),
      }),
    );
  };

  const held: Atom.Writable<Held<A>, (current: A) => A> = Atom.writable(
    (get) => {
      const adopt = (event: StorageEvent) => {
        if (event.key === null || event.key === options.key) {
          get.setSelf(latest(get.self<Held<A>>()));
        }
      };
      window.addEventListener("storage", adopt);
      get.addFinalizer(() => window.removeEventListener("storage", adopt));
      return latest(get.self<Held<A>>());
    },
    (ctx, change) => {
      const current = latest(Option.some(ctx.get(held)));
      const next = change(current.value);
      ctx.setSelf(next === current.value ? current : persist(next));
    },
  );

  return Atom.writable(
    (get) => get(held).value,
    (ctx, change) => ctx.set(held, change),
  );
};

export const newSaleId = (): InvoiceId => decodeInvoiceId(crypto.randomUUID());

export const saleDraftsAtom = Atom.family((workspace: string) =>
  sharedAtom({
    key: `store.sale-drafts.${workspace}`,
    schema: SaleDrafts,
    defaultValue: () => initialSaleDrafts(newSaleId()),
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
