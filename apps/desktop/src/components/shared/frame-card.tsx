import type * as React from "react";

import {
  Card,
  CardFrame,
  CardFrameAction,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@/components/ui/card";

export function FrameCard({
  action,
  children,
  description,
  flush = false,
  table = false,
  title,
  ...props
}: Omit<React.ComponentProps<typeof CardFrame>, "title"> & {
  action?: React.ReactNode;
  description?: React.ReactNode;
  flush?: boolean;
  table?: boolean;
  title?: React.ReactNode;
}): React.ReactElement {
  const hasHeader = title != null || description != null || action != null;

  return (
    <CardFrame {...props}>
      {hasHeader && (
        <CardFrameHeader className="flex h-11 min-w-0 flex-row items-center">
          {title != null && <CardFrameTitle className="shrink-0">{title}</CardFrameTitle>}
          {description != null && (
            <CardFrameDescription className="min-w-0">
              <span className="block truncate tabular-nums">{description}</span>
            </CardFrameDescription>
          )}
          {action != null && (
            <CardFrameAction className="ms-auto shrink-0 items-center">{action}</CardFrameAction>
          )}
        </CardFrameHeader>
      )}
      {table ? (
        children
      ) : flush ? (
        <Card className="flex-1 overflow-hidden">{children}</Card>
      ) : (
        <Card className="flex-1">
          <CardPanel>{children}</CardPanel>
        </Card>
      )}
    </CardFrame>
  );
}
