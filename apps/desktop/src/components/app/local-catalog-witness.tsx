import { useEffect } from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import { useCatalogIsReady } from "@/lib/inventory";
import { useCatalogHoldsNothing } from "@/lib/inventory/catalog-empty";
import { witnessBoundLocalCatalog } from "@/session/workspace-session";

const witnessLocalFile = () => {
  const read = appHost().publish?.localCatalog;
  if (!read) return;
  let current = true;
  void read()
    .then((report) => {
      if (!current || report._tag === "unknown") return;
      return witnessBoundLocalCatalog(report._tag);
    })
    .catch(() => undefined);
  return () => {
    current = false;
  };
};

function OpenLocalCatalog() {
  const holdsNothing = useCatalogHoldsNothing();
  useEffect(() => witnessLocalFile(), [holdsNothing]);
  return null;
}

function ClosedLocalCatalog() {
  useEffect(() => witnessLocalFile(), []);
  return null;
}

export function LocalCatalogWitness({ workspace }: { readonly workspace: Workspace }) {
  if (!useCatalogIsReady()) return null;
  switch (workspace._tag) {
    case "Local":
      return (
        <AsyncBoundary fallback={null}>
          <OpenLocalCatalog />
        </AsyncBoundary>
      );
    case "Organization":
      return <ClosedLocalCatalog />;
    case "None":
      return null;
  }
}
