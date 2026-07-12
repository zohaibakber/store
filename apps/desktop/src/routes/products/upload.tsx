import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/products/upload")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/products/bulk"!</div>;
}
