import { createFileRoute } from "@tanstack/react-router";

import { AccountSettings } from "@/components/settings/account-settings";

export const Route = createFileRoute("/settings/account")({
  component: AccountSettings,
  staticData: { breadcrumb: "Account" },
});
