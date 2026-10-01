import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: Outlet,
  staticData: { breadcrumb: "Settings" },
});
