import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { OrganizationSettings } from "@/components/settings/organization-settings";
import { formValidator } from "@/lib/form-schema";

const organizationSearch = formValidator(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/settings/organization")({
  validateSearch: organizationSearch,
  component: OrganizationSettings,
  staticData: { breadcrumb: "Organization" },
});
