import { useState } from "react";

import { AboutSettings } from "@/components/settings/about-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { PublishSettings } from "@/components/settings/publish-settings";
import { FrameCard } from "@/components/shared/frame-card";
import { PageLayout } from "@/components/shared/page-layout";
import { appHost } from "@/host";

export function SettingsPage() {
  const [keepsDataOnDevice] = useState(() => appHost().backup !== undefined);

  return (
    <PageLayout width="narrow">
      <AccountSettings />
      <OrganizationSettings />
      {keepsDataOnDevice ? (
        <FrameCard title="Data on this device">
          <div className="flex flex-col gap-3">
            <PublishSettings />
            <BackupSettings />
          </div>
        </FrameCard>
      ) : null}
      <AppearanceSettings />
      <AboutSettings />
    </PageLayout>
  );
}
