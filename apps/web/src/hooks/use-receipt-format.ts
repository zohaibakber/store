import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { useAuth } from "@/lib/auth";
import { receiptFormatAtom } from "@/lib/preferences";
import { receiptStoreName, type ReceiptFormat } from "@/lib/receipt-format";
import { useWorkspaceStorageKey } from "@/lib/workspace";

export const useReceiptFormat = (): ReceiptFormat =>
  useAtomValue(receiptFormatAtom(useWorkspaceStorageKey()));

export const useEditReceiptFormat = () => {
  const set = useAtomSet(receiptFormatAtom(useWorkspaceStorageKey()));
  return (changes: Partial<ReceiptFormat>) => set((current) => ({ ...current, ...changes }));
};

export const useOrganizationName = (): string | null => {
  const { workspace } = useAuth();
  return workspace._tag === "Organization" ? workspace.organization.name : null;
};

export const useReceiptStoreName = (): string | null =>
  receiptStoreName(useReceiptFormat(), useOrganizationName());
