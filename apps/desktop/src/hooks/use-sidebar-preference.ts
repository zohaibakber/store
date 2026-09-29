import { useCallback, useState } from "react";

const STORAGE_KEY = "store.sidebar-open";

const readStored = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const useSidebarPreference = (): readonly [boolean, (open: boolean) => void] => {
  const [open, setOpen] = useState(readStored);
  const remember = useCallback((next: boolean) => {
    setOpen(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
    } catch {
      return;
    }
  }, []);
  return [open, remember];
};
