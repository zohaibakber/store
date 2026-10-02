import { Cancel01Icon, Copy01Icon, MinusSignIcon, SquareIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { appHost } from "@/host";
import type { WindowControlsBridge } from "@/host";
import { cn } from "@/lib/utils";

function WindowControlButtons({ controls }: { readonly controls: WindowControlsBridge }) {
  const maximized = useSyncExternalStore(controls.onMaximizedChange, controls.isMaximized);
  return (
    <div
      className="flex items-center gap-1 [-webkit-app-region:no-drag]"
      data-slot="window-controls"
    >
      <Button
        aria-label="Minimise"
        onClick={() => controls.minimize()}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden="true" icon={MinusSignIcon} />
      </Button>
      <Button
        aria-label={maximized ? "Restore" : "Maximise"}
        onClick={() => controls.toggleMaximize()}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-3.5"
          icon={maximized ? Copy01Icon : SquareIcon}
        />
      </Button>
      <Button aria-label="Close" onClick={() => controls.close()} size="icon-sm" variant="ghost">
        <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
      </Button>
    </div>
  );
}

export function WindowControls() {
  const controls = appHost().shell?.window;
  return controls ? <WindowControlButtons controls={controls} /> : null;
}

export function WindowDragStrip({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-0 z-0 flex h-10 items-center justify-end pe-2 [-webkit-app-region:drag]",
        className,
      )}
      data-slot="window-drag-strip"
    >
      <WindowControls />
    </div>
  );
}
