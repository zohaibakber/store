import { useAtom } from "@effect/atom-react";
import {
  MAX_GLOBAL_SEARCH_QUERY_LENGTH,
  MIN_GLOBAL_SEARCH_QUERY_LENGTH,
  type GlobalProduct,
} from "@store/contracts/server-api.schema";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useMemo } from "react";

import { useOnline } from "@/hooks/use-online";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { storeErrorMessage } from "@/lib/errors";

const SEARCH_FAILED = "Could not search the web. Try again.";

const searchAtom = Atom.family((_key: string) =>
  Atom.fn((query: string) =>
    Effect.tryPromise({
      try: () => appHost().searchGlobalProducts(query),
      catch: (cause) => storeErrorMessage(cause, SEARCH_FAILED),
    }),
  ).pipe(Atom.setIdleTTL("10 minutes")),
);

const searchKey = (query: string) => query.trim().replace(/\s+/gu, " ").toLowerCase();

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
  const [result, submit] = useAtom(searchAtom(searchKey(trimmed)));

  const view = useMemo((): GlobalSearchView => {
    if (!signedIn) return { _tag: "SignedOut" };
    if (!online) return { _tag: "Offline" };
    if (trimmed === "") return { _tag: "Empty" };
    if (trimmed.length < MIN_GLOBAL_SEARCH_QUERY_LENGTH) return { _tag: "TooShort" };
    if (trimmed.length > MAX_GLOBAL_SEARCH_QUERY_LENGTH) return { _tag: "TooLong" };
    if (result.waiting) return { _tag: "Searching" };
    return AsyncResult.matchWithError(result, {
      onInitial: () => ({ _tag: "Ready", failure: null }),
      onSuccess: ({ value }) => ({ _tag: "Results", products: value.products }),
      onError: (failure) => ({ _tag: "Ready", failure }),
      onDefect: () => ({ _tag: "Ready", failure: SEARCH_FAILED }),
    });
  }, [online, result, signedIn, trimmed]);

  const search = useCallback(() => {
    if (view._tag === "Ready") submit(trimmed);
  }, [submit, trimmed, view]);

  return { view, search };
};
