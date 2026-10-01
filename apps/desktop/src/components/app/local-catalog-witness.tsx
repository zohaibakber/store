import { Suspense, useEffect } from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import type { Workspace } from "@/host-access";
import { useCatalogIsEmpty } from "@/lib/inventory/catalog-empty";
import { witnessBoundLocalCatalog } from "@/session/workspace-session";

function LocalCatalogState() {
  const empty = useCatalogIsEmpty();
  useEffect(() => {
    void witnessBoundLocalCatalog(empty ? "empty" : "stocked").catch(() => undefined);
  }, [empty]);
  return null;
}

export function LocalCatalogWitness({ workspace }: { readonly workspace: Workspace }) {
  switch (workspace._tag) {
    case "Local":
      return (
        <AppErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <LocalCatalogState />
          </Suspense>
        </AppErrorBoundary>
      );
    case "Organization":
    case "None":
      return null;
  }
}
