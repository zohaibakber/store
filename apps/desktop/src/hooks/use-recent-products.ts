import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import { useWorkspaceStorageKey } from "@/hooks/use-workspace-storage-key";
import { recentProductsAtom, type RecentProduct } from "@/lib/preferences";

export type { RecentProduct };

const LIMIT = 8;

export type RecentProductSource = {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly category: { readonly name: string };
};

export const useRecentProductsIn = (workspace: string): ReadonlyArray<RecentProduct> =>
  useAtomValue(recentProductsAtom(workspace));

export const useRememberRecentProductIn = (workspace: string) => {
  const setRecents = useAtomSet(recentProductsAtom(workspace));
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

export const useRecentProducts = (): ReadonlyArray<RecentProduct> =>
  useRecentProductsIn(useWorkspaceStorageKey());

export const useRememberRecentProduct = () => useRememberRecentProductIn(useWorkspaceStorageKey());
