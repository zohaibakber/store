import {
  Cancel01Icon,
  MinusSignIcon,
  SquareIcon,
  SquareSquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const controls = typeof window === "undefined" ? undefined : window.windowControls;

  useEffect(() => {
    if (!controls) return;
    void controls.isMaximized().then(setIsMaximized);
    void controls.isFullScreen().then(setIsFullScreen);

    return controls.onFullScreenChange(setIsFullScreen);
  }, [controls]);

  if (!controls || isFullScreen) return null;

  return (
    <div className="window-controls ml-auto flex items-center gap-1" aria-label="Window controls">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Minimize window"
        onClick={() => controls.minimize()}
      >
        <HugeiconsIcon icon={MinusSignIcon} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        onClick={() => {
          void controls.toggleMaximize().then(setIsMaximized);
        }}
      >
        {isMaximized ? (
          <HugeiconsIcon icon={SquareSquareIcon} />
        ) : (
          <HugeiconsIcon icon={SquareIcon} />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Close window"
        onClick={() => controls.close()}
      >
        <HugeiconsIcon icon={Cancel01Icon} />
      </Button>
    </div>
  );
}
