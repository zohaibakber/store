import type * as React from "react";

import { SettingsNav } from "@/components/settings/settings-nav";
import { PageContent, PageHeader, PageHeading, PageLayout } from "@/components/shared/page-layout";

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageLayout contentClassName="max-w-5xl">
      <PageHeader>
        <PageHeading>Settings</PageHeading>
      </PageHeader>

      <PageContent className="mt-2 flex flex-col gap-6">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </PageContent>
    </PageLayout>
  );
}
