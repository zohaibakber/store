import { WindowControls } from "@/components/window-controls";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-12 w-full shrink-0 items-center bg-background [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
      <div className="flex h-12 w-full items-center px-2">
        <SidebarTrigger />
        <WindowControls />
      </div>
    </header>
  );
}
