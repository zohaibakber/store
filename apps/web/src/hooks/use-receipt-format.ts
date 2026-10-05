import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { receiptFormatAtom } from "@/lib/preferences";
import { receiptStoreName, type ReceiptFormat } from "@/lib/receipt-format";
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace";

export const useReceiptFormat = (): ReceiptFormat =>
  useAtomValue(receiptFormatAtom(WORKSPACE_STORAGE_KEY));

export const useEditReceiptFormat = () => {
  const set = useAtomSet(receiptFormatAtom(WORKSPACE_STORAGE_KEY));
  return (changes: Partial<ReceiptFormat>) => set((current) => ({ ...current, ...changes }));
};

export const useReceiptStoreName = (): string | null => receiptStoreName(useReceiptFormat());
