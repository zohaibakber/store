import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "@store/contracts";
import type { CatalogLease } from "@store/inventory-react";

export const WORKSPACE_SCOPE: CatalogLease["scope"] = {
  organizationId: LOCAL_ORGANIZATION_ID,
  userId: LOCAL_USER_ID,
};

export const WORKSPACE_STORAGE_KEY = "local";
