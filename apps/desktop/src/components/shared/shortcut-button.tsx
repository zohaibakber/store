import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

export function ShortcutButton({
  children,
  label,
  shortcut,
  ...props
}: React.ComponentProps<typeof Button> & { readonly label: string; readonly shortcut: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-keyshortcuts={shortcut} size="sm" {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipPopup>
        <span className="inline-flex items-center gap-2">
          {label}
          <Kbd>{shortcut}</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
