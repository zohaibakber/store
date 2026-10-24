import { createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "@/components/settings/settings-layout";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
  staticData: { breadcrumb: "Settings" },
});
