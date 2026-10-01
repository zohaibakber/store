import { useEffect } from "react";

import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import { witnessBoundLocalCatalog } from "@/session/workspace-session";

function LocalFileWitness({ workspace }: { readonly workspace: "Local" | "Organization" }) {
  useEffect(() => {
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
  }, [workspace]);
  return null;
}

export function LocalCatalogWitness({ workspace }: { readonly workspace: Workspace }) {
  switch (workspace._tag) {
    case "Local":
    case "Organization":
      return <LocalFileWitness workspace={workspace._tag} />;
    case "None":
      return null;
  }
}
