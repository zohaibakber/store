import { useLicenceState } from "@store/inventory-react";
import type { ReactNode } from "react";

import { LicenceScreen } from "@/components/licence/screen";
import { StaffScreenLoading } from "@/components/staff/screen";

export function LicenceGate({ children }: { readonly children: ReactNode }) {
  const state = useLicenceState();
  if (state === undefined) return <StaffScreenLoading />;
  if (state._tag === "missing") return <LicenceScreen />;
  return children;
}
