import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSidebar } from "@/components/ui/sidebar";

export const isNewSaleKeyboardEvent = (event: KeyboardEvent): boolean =>
  event.code === "KeyN" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;

export function useNewSaleShortcut(): void {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    const go = () => {
      if (isMobile) setOpenMobile(false);
      void navigate({ to: "/invoices/new" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewSaleKeyboardEvent(event)) return;
      event.preventDefault();
      go();
    };

    window.addEventListener("keydown", onKeyDown, true);
    const stopDesktop = window.desktopShell?.onNewSale(go);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      stopDesktop?.();
    };
  }, [isMobile, navigate, setOpenMobile]);
}
