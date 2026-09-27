import { useAtomSuspense } from "@effect/atom-react";
import type { ProductRow } from "@store/client-db";

import type { ProductFacets, ProductListFilters, ProductListRequest } from "./product-list";
import { useCatalogReplica } from "./provider";

export const useSuspenseProductPage = (request: ProductListRequest): ReadonlyArray<ProductRow> =>
  useAtomSuspense(useCatalogReplica().atoms.productPage(request)).value;

export const useSuspenseProductCount = (filters: ProductListFilters): number =>
  useAtomSuspense(useCatalogReplica().atoms.productCount(filters)).value;

export const useSuspenseProductFacets = (): ProductFacets =>
  useAtomSuspense(useCatalogReplica().atoms.productFacets).value;
