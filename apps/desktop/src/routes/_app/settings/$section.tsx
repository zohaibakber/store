import { createFileRoute, Navigate } from "@tanstack/react-router";

import { defaultSettingsSection, settingsBreadcrumb } from "@/components/settings/sections";
import { useSettingsSections } from "@/components/settings/settings-layout";
import { SettingsPage } from "@/components/settings/settings-page";
import { preloadInventory } from "@/lib/inventory/preload";

export const Route = createFileRoute("/_app/settings/$section")({
  loader: ({ context }) => preloadInventory(context),
  component: SettingsSectionRoute,
  staticData: { breadcrumb: (_loaderData, params) => settingsBreadcrumb(params.section) },
});

function SettingsSectionRoute() {
  const { section } = Route.useParams();
  const current = useSettingsSections().find((available) => available === section);

  if (current === undefined) {
    return (
      <Navigate params={{ section: defaultSettingsSection }} replace to="/settings/$section" />
    );
  }

  return <SettingsPage section={current} />;
}
