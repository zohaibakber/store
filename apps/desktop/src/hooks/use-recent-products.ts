import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

const RecentProductSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  strength: Schema.NullOr(Schema.String),
  categoryName: Schema.String,
});

export type RecentProduct = typeof RecentProductSchema.Type;

type RecentProductsCache = {
  readonly raw: string | null;
  readonly value: ReadonlyArray<RecentProduct>;
};

const RecentProductsJson = Schema.fromJsonString(Schema.Array(RecentProductSchema));
const decodeRecentProducts = Schema.decodeUnknownOption(RecentProductsJson);
const encodeRecentProducts = Schema.encodeSync(RecentProductsJson);

const STORAGE_KEY = "store.recent-products";
const LIMIT = 8;
const listeners = new Set<() => void>();
const NONE: ReadonlyArray<RecentProduct> = [];

let cache: RecentProductsCache = { raw: null, value: NONE };

const readRaw = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
};

const snapshot = (): ReadonlyArray<RecentProduct> => {
  const raw = readRaw();
  if (raw !== cache.raw) {
    const value =
      raw === null
        ? NONE
        : Option.match(decodeRecentProducts(raw), {
            onNone: () => NONE,
            onSome: (products) => products.slice(0, LIMIT),
          });
    cache = { raw, value };
  }
  return cache.value;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

export type RecentProductSource = {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly category: { readonly name: string };
};

export const rememberRecentProduct = (product: RecentProductSource): void => {
  const entry: RecentProduct = {
    id: product.id,
    name: product.name,
    strength: product.strength,
    categoryName: product.category.name,
  };
  const next = [entry, ...snapshot().filter((recent) => recent.id !== product.id)].slice(0, LIMIT);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, encodeRecentProducts(next));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
};

export const useRecentProducts = (): ReadonlyArray<RecentProduct> =>
  useSyncExternalStore(subscribe, snapshot, () => NONE);
