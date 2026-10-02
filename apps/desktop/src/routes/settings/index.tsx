import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { SettingsPage } from "@/components/settings/settings-page";
import { formValidator } from "@/lib/form-schema";
import { preloadCatalog } from "@/lib/inventory";

const settingsSearch = formValidator(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/settings/")({
  validateSearch: settingsSearch,
  loader: ({ context }) => preloadCatalog(context),
  component: SettingsPage,
});
