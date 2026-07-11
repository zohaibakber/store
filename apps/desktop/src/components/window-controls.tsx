import { Button } from "@/components/ui/button";
import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  Cancel01Icon,
  MinusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    void window.windowControls.isMaximized().then(setIsMaximized);
    void window.windowControls.isFullScreen().then(setIsFullScreen);

    return window.windowControls.onFullScreenChange(setIsFullScreen);
  }, []);

  if (isFullScreen) return null;

  return (
    <div className="window-controls ml-auto flex items-center gap-1" aria-label="Window controls">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Minimize window"
        onClick={() => window.windowControls.minimize()}
      >
        <HugeiconsIcon icon={MinusSignIcon} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        onClick={() => {
          void window.windowControls.toggleMaximize().then(setIsMaximized);
        }}
      >
        {isMaximized ? (
          <HugeiconsIcon icon={ArrowShrink02Icon} />
        ) : (
          <HugeiconsIcon icon={ArrowExpand01Icon} />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close window"
        onClick={() => window.windowControls.close()}
      >
        <HugeiconsIcon icon={Cancel01Icon} />
      </Button>
    </div>
  );
}
