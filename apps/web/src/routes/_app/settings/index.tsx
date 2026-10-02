import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { SettingsPage } from "@/components/settings/settings-page";
import { preloadInventory } from "@/lib/inventory/preload";

const settingsSearch = Schema.toStandardSchemaV1(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/_app/settings/")({
  validateSearch: settingsSearch,
  loader: ({ context }) => preloadInventory(context),
  component: SettingsPage,
});
