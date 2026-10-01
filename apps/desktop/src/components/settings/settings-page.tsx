import { useId, useState } from "react";
import type * as React from "react";

import { AboutSettings } from "@/components/settings/about-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { PublishSettings } from "@/components/settings/publish-settings";
import { PageLayout } from "@/components/shared/page-layout";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";

function SettingsGroup({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h2 className="px-1 text-sm font-medium text-muted-foreground" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const signedIn = auth.snapshot?.status === "authenticated";
  const [keepsDataOnDevice] = useState(() => appHost().backup !== undefined);

  return (
    <PageLayout contentClassName="gap-6" width="narrow">
      <SettingsGroup title="Account">
        <AccountSettings />
      </SettingsGroup>
      {signedIn ? (
        <SettingsGroup title="Organization">
          <OrganizationSettings />
        </SettingsGroup>
      ) : null}
      {keepsDataOnDevice ? (
        <SettingsGroup title="Data on this device">
          <PublishSettings />
          <BackupSettings />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="Appearance">
        <AppearanceSettings />
      </SettingsGroup>
      <SettingsGroup title="About">
        <AboutSettings />
      </SettingsGroup>
    </PageLayout>
  );
}
