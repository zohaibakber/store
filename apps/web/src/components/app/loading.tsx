import { WindowDragStrip } from "@/components/app/window-controls";
import { BrandMark } from "@/components/brand-mark";

export function AppLoading({ label = "Loading" }: { label?: string }) {
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background">
      <WindowDragStrip />
      <div aria-label={label} className="flex size-24 items-center justify-center">
        <BrandMark className="size-16 rounded-xl object-contain" />
      </div>
    </main>
  );
}
