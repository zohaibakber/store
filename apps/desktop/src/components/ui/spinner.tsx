import { Loading03Icon as HugeLoading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import { cn } from "@/lib/utils";

function Loader2Icon(
  props: Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">,
): React.ReactElement {
  return <HugeiconsIcon icon={HugeLoading03Icon} {...props} />;
}

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
