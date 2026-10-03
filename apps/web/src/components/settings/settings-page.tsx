import { AboutSettings } from "@/components/settings/about-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { PublishSettings } from "@/components/settings/publish-settings";
import { ReceiptSettings } from "@/components/settings/receipt-settings";
import type { SettingsSection } from "@/components/settings/sections";
import { FrameCard } from "@/components/shared/frame-card";

export function SettingsPage({ section }: { readonly section: SettingsSection }) {
  switch (section) {
    case "account":
      return <AccountSettings />;
    case "organization":
      return <OrganizationSettings />;
    case "receipts":
      return <ReceiptSettings />;
    case "data":
      return (
        <FrameCard title="Data on this device">
          <div className="flex flex-col gap-3">
            <PublishSettings />
            <BackupSettings />
          </div>
        </FrameCard>
      );
    case "general":
      return (
        <>
          <AppearanceSettings />
          <AboutSettings />
        </>
      );
  }
}
