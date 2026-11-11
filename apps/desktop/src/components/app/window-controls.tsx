import { useAtomValue } from "@effect/atom-react";
import { Cancel01Icon, Copy01Icon, MinusSignIcon, SquareIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { Button } from "@/components/ui/button";
import { fireShell, shell } from "@/host/shell";
import { cn } from "@/lib/utils";

const windowMaximized = Atom.make(
  Stream.unwrap(Effect.map(shell, (client) => client.WindowMaximized())),
).pipe(Atom.keepAlive);

export function WindowControls() {
  const maximized = useAtomValue(windowMaximized, (result) =>
    AsyncResult.getOrElse(result, () => false),
  );
  return (
    <div
      className="flex items-center gap-1 [-webkit-app-region:no-drag]"
      data-slot="window-controls"
    >
      <Button
        aria-label="Minimise"
        onClick={() => fireShell((client) => client.WindowMinimize())}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden="true" icon={MinusSignIcon} />
      </Button>
      <Button
        aria-label={maximized ? "Restore" : "Maximise"}
        onClick={() => fireShell((client) => client.WindowToggleMaximize())}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-3.5"
          icon={maximized ? Copy01Icon : SquareIcon}
        />
      </Button>
      <Button
        aria-label="Close"
        onClick={() => fireShell((client) => client.WindowClose())}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
      </Button>
    </div>
  );
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
