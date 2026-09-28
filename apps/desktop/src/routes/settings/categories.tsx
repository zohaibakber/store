import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/categories")({
  beforeLoad: () => {
    throw redirect({ to: "/products/categories", replace: true });
  },
});
