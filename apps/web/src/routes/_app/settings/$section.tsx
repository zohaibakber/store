import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { formValidator } from "@/lib/form-schema";

const sectionSearch = formValidator(
  Schema.Struct({
    invitation: Schema.optionalKey(Schema.String),
  }),
);

export const Route = createFileRoute("/_app/settings/$section")({
  validateSearch: sectionSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings", search, replace: true });
  },
});
