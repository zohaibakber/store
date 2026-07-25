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
  panelClassName,
  title,
  ...props
}: Omit<React.ComponentProps<typeof CardFrame>, "title"> & {
  action?: React.ReactNode;
  description?: React.ReactNode;
  panelClassName?: string;
  title?: React.ReactNode;
}): React.ReactElement {
  const hasHeader = title != null || description != null || action != null;

  return (
    <CardFrame {...props}>
      {hasHeader && (
        <CardFrameHeader>
          {title != null && <CardFrameTitle>{title}</CardFrameTitle>}
          {description != null && <CardFrameDescription>{description}</CardFrameDescription>}
          {action != null && <CardFrameAction>{action}</CardFrameAction>}
        </CardFrameHeader>
      )}
      <Card className="flex-1">
        <CardPanel className={panelClassName}>{children}</CardPanel>
      </Card>
    </CardFrame>
  );
}
