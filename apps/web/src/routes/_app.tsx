import { createFileRoute } from "@tanstack/react-router";

import { NotFound } from "@/components/app/not-found";
import { AppShell } from "@/components/app/shell";

export const Route = createFileRoute("/_app")({
  component: AppShell,
  notFoundComponent: NotFound,
});
