import {
  Building01Icon,
  InformationCircleIcon,
  PaintBoardIcon,
  ReloadIcon,
  TagIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Category } from "@store/contracts";
import { useState } from "react";

import { AccountSettings } from "@/components/settings/account-settings";
import { CategorySettings } from "@/components/settings/category-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { ThemePicker } from "@/components/settings/theme-picker";
import { FrameCard } from "@/components/shared/frame-card";
import { PageContent, PageHeader, PageHeading, PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { canCheckForAppUpdate, checkForAppUpdate } from "@/hooks/use-app-updater";
import { useLinkedInvitation } from "@/lib/organization";

const tabs = [
  { value: "account", label: "Account", icon: UserIcon },
  { value: "organization", label: "Organization", icon: Building01Icon },
  { value: "categories", label: "Categories", icon: TagIcon },
  { value: "appearance", label: "Appearance", icon: PaintBoardIcon },
  { value: "about", label: "About", icon: InformationCircleIcon },
] as const;

function AboutSettings() {
  const [supportsUpdates] = useState(canCheckForAppUpdate);

  return (
    <FrameCard title="About Tabaaq">
      <div className="flex flex-col gap-4">
        <dl className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono tabular-nums">v{__APP_VERSION__}</dd>
        </dl>
        {supportsUpdates ? (
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Updates</p>
              <p className="text-sm text-muted-foreground">
                Check GitHub for a newer desktop build.
              </p>
            </div>
            <Button className="shrink-0" onClick={checkForAppUpdate} variant="outline">
              <HugeiconsIcon aria-hidden="true" icon={ReloadIcon} />
              Check for updates
            </Button>
          </div>
        ) : null}
      </div>
    </FrameCard>
  );
}

export function SettingsPage({ categories }: { categories: ReadonlyArray<Category> }) {
  // An invite link points at this page, so it opens where the invitation is
  // redeemed rather than on the account the recipient is already signed in to.
  const invited = useLinkedInvitation() !== "";

  return (
    <PageLayout contentClassName="max-w-5xl">
      <PageHeader>
        <PageHeading>Settings</PageHeading>
      </PageHeader>

      <PageContent className="mt-2">
        <Tabs
          className="w-full items-start gap-6"
          defaultValue={invited ? "organization" : "account"}
          orientation="vertical"
        >
          <TabsList className="w-44 shrink-0">
            {tabs.map((tab) => (
              <TabsTab className="justify-start gap-2" key={tab.value} value={tab.value}>
                <HugeiconsIcon aria-hidden="true" className="size-4" icon={tab.icon} />
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>

          <TabsPanel className="min-w-0 flex-1" value="account">
            <AccountSettings />
          </TabsPanel>
          <TabsPanel className="min-w-0 flex-1" value="organization">
            <OrganizationSettings />
          </TabsPanel>
          <TabsPanel className="min-w-0 flex-1" value="categories">
            <CategorySettings categories={categories} />
          </TabsPanel>
          <TabsPanel className="min-w-0 flex-1" value="appearance">
            <FrameCard description="Applies immediately on this device." title="Appearance">
              <ThemePicker />
            </FrameCard>
          </TabsPanel>
          <TabsPanel className="min-w-0 flex-1" value="about">
            <AboutSettings />
          </TabsPanel>
        </Tabs>
      </PageContent>
    </PageLayout>
  );
}
