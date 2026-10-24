import { createFileRoute, Navigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { defaultSettingsSection, settingsBreadcrumb } from "@/components/settings/sections";
import { useSettingsSections } from "@/components/settings/settings-layout";
import { SettingsPage } from "@/components/settings/settings-page";
import { preloadInventory } from "@/lib/inventory/preload";

const sectionSearch = Schema.toStandardSchemaV1(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/_app/settings/$section")({
  validateSearch: sectionSearch,
  loader: ({ context }) => preloadInventory(context),
  component: SettingsSectionRoute,
  staticData: { breadcrumb: (_loaderData, params) => settingsBreadcrumb(params.section) },
});

function SettingsSectionRoute() {
  const { section } = Route.useParams();
  const search = Route.useSearch();
  const current = useSettingsSections().find((available) => available === section);

  if (current === undefined) {
    return (
      <Navigate
        params={{ section: defaultSettingsSection }}
        replace
        search={search}
        to="/settings/$section"
      />
    );
  }

  return <SettingsPage section={current} />;
}
