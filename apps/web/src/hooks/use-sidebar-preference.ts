import { useAtom } from "@effect/atom-react";

import { sidebarOpenAtom } from "@/lib/preferences";

export const useSidebarPreference = (): readonly [boolean, (open: boolean) => void] =>
  useAtom(sidebarOpenAtom);
