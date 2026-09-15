import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { OrganizationSettings } from "@/components/settings/organization-settings";

const organizationSearch = z.object({
  invitation: z.string().optional(),
});

export const Route = createFileRoute("/settings/organization")({
  validateSearch: organizationSearch,
  component: OrganizationSettings,
  staticData: { breadcrumb: "Organization" },
});
