import type * as React from "react";

import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/ui/frame";

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
    <FramePanel className="flex-1 overflow-hidden">
      <div className="-m-5 **:data-[slot=table-cell]:first:ps-5 **:data-[slot=table-cell]:last:pe-5 **:data-[slot=table-head]:h-8 **:data-[slot=table-head]:text-xs **:data-[slot=table-head]:first:ps-5 **:data-[slot=table-head]:last:pe-5">
        {children}
      </div>
    </FramePanel>
  ) : flush ? (
    <FramePanel className="flex-1 overflow-hidden">
      <div className="-m-5">{children}</div>
    </FramePanel>
  ) : (
    <FramePanel className="flex-1">{children}</FramePanel>
  );

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
