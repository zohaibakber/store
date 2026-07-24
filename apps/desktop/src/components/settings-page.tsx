import { Building01Icon, PaintBoardIcon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FrameCard } from "@/components/frame-card";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { AccountSettings } from "@/components/settings/account-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { ThemePicker } from "@/components/settings/theme-picker";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";

const tabs = [
  { value: "account", label: "Account", icon: UserIcon },
  { value: "organization", label: "Organization", icon: Building01Icon },
  { value: "appearance", label: "Appearance", icon: PaintBoardIcon },
] as const;

export function SettingsPage() {
  return (
    <PageLayout contentClassName="max-w-5xl">
      <PageHeader>
        <PageHeading>Settings</PageHeading>
        <PageDescription>Your account, your organization, and how the app looks.</PageDescription>
      </PageHeader>

      <PageContent>
        <Tabs className="w-full items-start gap-6" defaultValue="account" orientation="vertical">
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
          <TabsPanel className="min-w-0 flex-1" value="appearance">
            <FrameCard description="Applies immediately on this device." title="Appearance">
              <ThemePicker />
            </FrameCard>
          </TabsPanel>
        </Tabs>
      </PageContent>
    </PageLayout>
  );
}
