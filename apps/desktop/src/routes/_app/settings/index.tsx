import { createFileRoute, redirect } from "@tanstack/react-router";

import { defaultSettingsSection } from "@/components/settings/sections";

export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/$section",
      params: { section: defaultSettingsSection },
      replace: true,
    });
  },
});
