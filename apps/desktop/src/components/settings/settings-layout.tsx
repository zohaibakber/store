import type * as React from "react";

import { SettingsNav } from "@/components/settings/settings-nav";
import { PageLayout } from "@/components/shared/page-layout";

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageLayout width="narrow">
      <SettingsNav />
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </PageLayout>
  );
}
