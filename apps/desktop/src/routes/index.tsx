import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/components/dashboard/home-page";

export const Route = createFileRoute("/")({
  component: HomePage,
});
