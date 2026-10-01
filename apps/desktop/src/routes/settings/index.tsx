import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { SettingsPage } from "@/components/settings/settings-page";
import { formValidator } from "@/lib/form-schema";

const settingsSearch = formValidator(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/settings/")({
  validateSearch: settingsSearch,
  component: SettingsPage,
});
