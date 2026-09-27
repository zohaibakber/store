import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { appHost } from "@/host";

export function useNewSaleShortcut(): void {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    const host = appHost();
    const go = () => {
      if (isMobile) setOpenMobile(false);
      void navigate({ to: "/invoices/new" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!host.newSaleShortcut.matches(event)) return;
      event.preventDefault();
      go();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const stopShell = host.shell?.onNewSale(go);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      stopShell?.();
    };
  }, [isMobile, navigate, setOpenMobile]);
}
