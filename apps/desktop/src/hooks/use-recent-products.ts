import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import { recentProductsAtom, type RecentProduct } from "@/lib/preferences";
import { useWorkspaceStorageKey } from "@/lib/workspace";

export type { RecentProduct };

const LIMIT = 8;

type RecentProductSource = {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly category: { readonly name: string };
};

export const useRecentProducts = (): ReadonlyArray<RecentProduct> =>
  useAtomValue(recentProductsAtom(useWorkspaceStorageKey()));

export const useRememberRecentProduct = () => {
  const setRecents = useAtomSet(recentProductsAtom(useWorkspaceStorageKey()));
  return useCallback(
    (product: RecentProductSource) => {
      const entry: RecentProduct = {
        id: product.id,
        name: product.name,
        strength: product.strength,
        categoryName: product.category.name,
      };
      setRecents((current) =>
        [entry, ...current.filter((recent) => recent.id !== product.id)].slice(0, LIMIT),
      );
    },
    [setRecents],
  );
};
