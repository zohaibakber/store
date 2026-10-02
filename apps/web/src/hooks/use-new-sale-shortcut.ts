import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { useSaleDraftStore } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { hasOpenModal } from "@/lib/shortcuts";

const NEW_SALE_PATH = "/invoices/new";

export const useStartSale = () => {
  const router = useRouter();
  const store = useSaleDraftStore();
  return () => {
    if (router.state.location.pathname === NEW_SALE_PATH) store.open();
    else void router.navigate({ to: NEW_SALE_PATH });
  };
};

export function useNewSaleShortcut(): void {
  const startSale = useStartSale();
  const { isMobile, setOpenMobile } = useSidebar();

  const go = useEffectEvent(() => {
    if (isMobile) setOpenMobile(false);
    else if (hasOpenModal()) return;
    startSale();
  });

  useEffect(() => {
    const host = appHost();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!host.newSaleShortcut.matches(event)) return;
      event.preventDefault();
      go();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const stopShell = host.shell?.onNewSale(() => go());
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      stopShell?.();
    };
  }, []);
}
