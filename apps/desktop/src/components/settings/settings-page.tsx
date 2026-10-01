import { useState } from "react";

import { AboutSettings } from "@/components/settings/about-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { DataSettings } from "@/components/settings/data-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { PageLayout } from "@/components/shared/page-layout";
import { appHost } from "@/host";

export function SettingsPage() {
  const [keepsDataOnDevice] = useState(() => appHost().backup !== undefined);

  return (
    <PageLayout width="narrow">
      <AccountSettings />
      <OrganizationSettings />
      {keepsDataOnDevice ? <DataSettings /> : null}
      <AppearanceSettings />
      <AboutSettings />
    </PageLayout>
  );
}
