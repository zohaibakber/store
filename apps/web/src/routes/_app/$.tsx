import { createFileRoute } from "@tanstack/react-router";

import { NotFound } from "@/components/app/not-found";

export const Route = createFileRoute("/_app/$")({
  component: NotFound,
});
