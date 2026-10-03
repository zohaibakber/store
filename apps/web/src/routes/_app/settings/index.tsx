import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { defaultSettingsSection } from "@/components/settings/sections";

const settingsSearch = Schema.toStandardSchemaV1(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/_app/settings/")({
  validateSearch: settingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/$section",
      params: {
        section: search.invitation === undefined ? defaultSettingsSection : "organization",
      },
      search,
      replace: true,
    });
  },
});
