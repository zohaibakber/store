import { Maximize2, Minus, Shrink, X } from "lucide-react";
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
    <div className="window-controls ml-auto flex h-full self-stretch" aria-label="Window controls">
      <button
        type="button"
        className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Minimize window"
        onClick={() => window.windowControls.minimize()}
      >
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        onClick={() => {
          void window.windowControls.toggleMaximize().then(setIsMaximized);
        }}
      >
        {isMaximized ? (
          <Shrink className="size-3.5" strokeWidth={1.5} />
        ) : (
          <Maximize2 className="size-3.5" strokeWidth={1.5} />
        )}
      </button>
      <button
        type="button"
        className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Close window"
        onClick={() => window.windowControls.close()}
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
