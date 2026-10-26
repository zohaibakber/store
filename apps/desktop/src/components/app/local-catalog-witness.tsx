import { useAtomSet } from "@effect/atom-react";
import { useCatalogIsReady } from "@store/inventory-react";
import { useEffect } from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import { useCatalogHoldsNothing } from "@/lib/inventory/catalog-empty";
import { witnessLocalCatalog } from "@/session/workspace-session";

const witnessLocalFile = (witness: (state: "empty" | "stocked") => Promise<void>) => {
  let current = true;
  void appHost()
    .publish.localCatalog()
    .then((report) => {
      if (!current || report._tag === "unknown") return;
      return witness(report._tag);
    })
    .catch(() => undefined);
  return () => {
    current = false;
  };
};

function OpenLocalCatalog() {
  const holdsNothing = useCatalogHoldsNothing();
  const witness = useAtomSet(witnessLocalCatalog, { mode: "promise" });
  useEffect(() => witnessLocalFile(witness), [holdsNothing, witness]);
  return null;
}

function ClosedLocalCatalog() {
  const witness = useAtomSet(witnessLocalCatalog, { mode: "promise" });
  useEffect(() => witnessLocalFile(witness), [witness]);
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
