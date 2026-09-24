import {
  type CatalogProductSearchResult,
  useCatalogCategories,
  useCatalogProductSearch,
  useCatalogReplica,
  useInventoryActions,
} from "@store/inventory-react";
import { useLiveQuery } from "@tanstack/react-db";
import * as React from "react";

import type { CommitPlan, MatchedProduct } from "./fields";
import { type CatalogCandidate, type ScanIdentity, brandQuery, pickCatalogMatch } from "./matching";
import type { ScanDraft } from "./model";

export type ScanMatch = {
  readonly product: MatchedProduct;
  readonly composition: string | null;
  readonly strength: string | null;
  readonly availableUnits: number;
};

export const identityOf = (draft: ScanDraft): ScanIdentity =>
  draft.parse._tag === "Parsed"
    ? {
        name: draft.parse.result.name,
        composition: draft.parse.result.composition,
        strength: draft.parse.result.strength,
      }
    : { name: null, composition: null, strength: null };

const searchQuery = (identity: ScanIdentity): string => {
  const brand = brandQuery(identity);
  if (brand) return brand;
  const [ingredient] = (identity.composition ?? "").trim().split(/\s+/);
  return ingredient ?? "";
};

export const toMatch = (result: CatalogProductSearchResult): ScanMatch => ({
  product: {
    id: result.product.id,
    name: result.product.name,
    unitsPerPack: result.product.unitsPerPack,
  },
  composition: result.product.composition,
  strength: result.product.strength,
  availableUnits: result.stock.availableUnits,
});

export const useScanMatch = ({ name, composition, strength }: ScanIdentity) => {
  const query = searchQuery({ name, composition, strength });
  const search = useCatalogProductSearch(query, 25);
  const match = React.useMemo(() => {
    if (!query) return null;
    const best = pickCatalogMatch(
      search.data.map((result) => result.product),
      { name, composition, strength },
    );
    const found =
      best === null ? undefined : search.data.find((result) => result.product.id === best.id);
    return found === undefined ? null : toMatch(found);
  }, [query, search.data, name, composition, strength]);
  return { match, isLoading: query !== "" && search.isLoading };
};

const PICKER_LIMIT = 20;

export const useProductChoices = (query: string) => {
  const search = useCatalogProductSearch(query, PICKER_LIMIT);
  const choices = React.useMemo(() => search.data.map(toMatch), [search.data]);
  return { choices, isLoading: search.isLoading };
};

export const useCatalogMatcher = () => {
  const inventory = useCatalogReplica();
  const products = useLiveQuery(
    (builder) => builder.from({ product: inventory.products }),
    [inventory],
  );
  return React.useCallback(
    (identity: ScanIdentity): CatalogCandidate | null =>
      identity.name === null && identity.composition === null
        ? null
        : pickCatalogMatch(products.data, identity),
    [products.data],
  );
};

export type ExecutablePlan = Exclude<CommitPlan, { readonly _tag: "Invalid" }>;

export type CategoryChoice = { readonly id: string; readonly name: string };

export const useCategoryChoices = () => {
  const categories = useCatalogCategories();
  return React.useMemo(() => {
    const choices: ReadonlyArray<CategoryChoice> = categories.data.map((category) => ({
      id: category.id,
      name: category.name,
    }));
    const preferred =
      choices.find((category) => category.name.trim().toLowerCase() === "general") ??
      choices[0] ??
      null;
    return { choices, preferredId: preferred?.id ?? null };
  }, [categories.data]);
};

export const useScanCommit = () => {
  const actions = useInventoryActions();
  return React.useCallback(
    async (plan: ExecutablePlan, categoryId: string | null): Promise<void> => {
      if (plan._tag === "AddBatch") {
        await actions.receiveBatch({ productId: plan.productId, ...plan.batch });
        return;
      }
      const productCategory = categoryId ?? (await actions.createCategory({ name: "General" })).id;
      await actions.createProductWithBatch({
        product: { ...plan.product, categoryId: productCategory },
        batch: plan.batch,
      });
    },
    [actions],
  );
};
