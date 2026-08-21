import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SettingsLayout } from "@/components/settings/settings-layout";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
  staticData: { breadcrumb: "Settings" },
});

function SettingsRoute() {
  return (
    <SettingsLayout>
      <Outlet />
    </SettingsLayout>
  );
}
