import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/components/settings/page";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) => context.store.listCategories(),
  component: SettingsRoute,
  staticData: { breadcrumb: "Settings" },
});

function SettingsRoute() {
  return <SettingsPage categories={Route.useLoaderData()} />;
}
