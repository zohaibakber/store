import { useState } from "react";

import { toastStoreError } from "@/lib/errors";

export const useStoreCommand = () => {
  const [pending, setPending] = useState(false);
  const run = async (command: () => Promise<void>, fallback?: string) => {
    setPending(true);
    try {
      await command();
    } catch (cause) {
      toastStoreError(cause, fallback);
    }
    setPending(false);
  };
  return [pending, run] as const;
};
