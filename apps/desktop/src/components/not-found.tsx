import { Link } from "@tanstack/react-router";
import { HomeIcon, RouteOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function NotFound() {
  return (
    <Empty className="min-h-[calc(100svh-4rem)]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RouteOffIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          The page you’re looking for doesn’t exist or may have been moved.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" render={<Link to="/" />}>
          <HomeIcon aria-hidden="true" />
          Return home
        </Button>
      </EmptyContent>
    </Empty>
  );
}
