import {
  MAX_GLOBAL_SEARCH_QUERY_LENGTH,
  MIN_GLOBAL_SEARCH_QUERY_LENGTH,
  type GlobalProduct,
} from "@store/contracts/server-api.schema";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useOnline } from "@/hooks/use-online";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { storeErrorMessage } from "@/lib/errors";

const MAX_REMEMBERED_SEARCHES = 50;
const SEARCH_FAILED = "Could not search the web. Try again.";

type SearchState =
  | { readonly _tag: "Searching" }
  | { readonly _tag: "Found"; readonly products: ReadonlyArray<GlobalProduct> }
  | { readonly _tag: "Failed"; readonly message: string };

const SEARCHING: SearchState = { _tag: "Searching" };

const searches = new Map<string, SearchState>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const record = (key: string, state: SearchState) => {
  searches.delete(key);
  searches.set(key, state);
  for (const oldest of searches.keys()) {
    if (searches.size <= MAX_REMEMBERED_SEARCHES) break;
    searches.delete(oldest);
  }
  for (const listener of listeners) listener();
};

const start = (key: string, query: string) => {
  const current = searches.get(key);
  if (current?._tag === "Searching" || current?._tag === "Found") return;
  record(key, SEARCHING);
  appHost()
    .searchGlobalProducts(query)
    .then(
      (result) => record(key, { _tag: "Found", products: result.products }),
      (cause: unknown) =>
        record(key, { _tag: "Failed", message: storeErrorMessage(cause, SEARCH_FAILED) }),
    );
};

const searchKey = (query: string) => query.trim().replace(/\s+/gu, " ").toLowerCase();

const searchable = (text: string) =>
  text.length >= MIN_GLOBAL_SEARCH_QUERY_LENGTH && text.length <= MAX_GLOBAL_SEARCH_QUERY_LENGTH;

export type GlobalSearchView =
  | { readonly _tag: "SignedOut" }
  | { readonly _tag: "Offline" }
  | { readonly _tag: "Empty" }
  | { readonly _tag: "TooShort" }
  | { readonly _tag: "TooLong" }
  | { readonly _tag: "Ready"; readonly failure: string | null }
  | { readonly _tag: "Searching" }
  | { readonly _tag: "Results"; readonly products: ReadonlyArray<GlobalProduct> };

export const canSearchGlobally = (view: GlobalSearchView): boolean => {
  switch (view._tag) {
    case "Ready":
    case "Searching":
    case "Results":
      return true;
    case "SignedOut":
    case "Offline":
    case "Empty":
    case "TooShort":
    case "TooLong":
      return false;
  }
};

export const useGlobalProductSearch = (query: string) => {
  const { snapshot } = useAuth();
  const online = useOnline();
  const signedIn = snapshot?.status === "authenticated";
  const trimmed = query.trim();
  const key = searchKey(trimmed);
  const state = useSyncExternalStore(subscribe, () => searches.get(key));

  const view = useMemo((): GlobalSearchView => {
    if (!signedIn) return { _tag: "SignedOut" };
    if (!online) return { _tag: "Offline" };
    if (trimmed === "") return { _tag: "Empty" };
    if (trimmed.length < MIN_GLOBAL_SEARCH_QUERY_LENGTH) return { _tag: "TooShort" };
    if (trimmed.length > MAX_GLOBAL_SEARCH_QUERY_LENGTH) return { _tag: "TooLong" };
    if (state === undefined) return { _tag: "Ready", failure: null };
    switch (state._tag) {
      case "Found":
        return { _tag: "Results", products: state.products };
      case "Searching":
        return { _tag: "Searching" };
      case "Failed":
        return { _tag: "Ready", failure: state.message };
    }
  }, [online, signedIn, state, trimmed]);

  const search = useCallback(
    (requested: string) => {
      const text = requested.trim();
      if (signedIn && online && searchable(text)) start(searchKey(text), text);
    },
    [online, signedIn],
  );

  return { view, search };
};
