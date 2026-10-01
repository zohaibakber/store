import type * as React from "react";

import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";
import { cn } from "@/lib/utils";

export function FrameCard({
  action,
  children,
  className,
  description,
  flush = false,
  table,
  title,
  ...props
}: Omit<React.ComponentProps<typeof Frame>, "title"> & {
  action?: React.ReactNode;
  description?: React.ReactNode;
  flush?: boolean;
  table?: boolean;
  title?: React.ReactNode;
}): React.ReactElement {
  const hasHeader = title != null || description != null || action != null;
  const body = table ? (
    children
  ) : flush ? (
    <FramePanel className="flex-1 overflow-hidden">
      <div className="-m-5">{children}</div>
    </FramePanel>
  ) : (
    <FramePanel className="flex-1">{children}</FramePanel>
  );

  if (table !== undefined) {
    return (
      <section className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
        {hasHeader && (
          <div className="flex min-h-7 min-w-0 items-center gap-3 px-1">
            {title != null && <h2 className="shrink-0 text-sm font-medium">{title}</h2>}
            {description != null && (
              <p className="min-w-0 truncate text-sm text-muted-foreground tabular-nums">
                {description}
              </p>
            )}
            {action != null && <div className="ms-auto flex shrink-0 items-center">{action}</div>}
          </div>
        )}
        <Frame>{body}</Frame>
      </section>
    );
  }

  return (
    <Frame className={className} {...props}>
      {hasHeader && (
        <FrameHeader className="min-w-0 flex-row items-center">
          {title != null && <FrameTitle className="shrink-0">{title}</FrameTitle>}
          {description != null && (
            <FrameDescription className="ms-3 min-w-0">
              <span className="block truncate tabular-nums">{description}</span>
            </FrameDescription>
          )}
          {action != null && (
            <div className="-my-2 ms-auto flex shrink-0 items-center ps-3">{action}</div>
          )}
        </FrameHeader>
      )}
      {body}
    </Frame>
  );
}
