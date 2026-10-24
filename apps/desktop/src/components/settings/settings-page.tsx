import { LicenceSettings } from "@/components/licence/settings";
import { AboutSettings } from "@/components/settings/about-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { ReceiptSettings } from "@/components/settings/receipt-settings";
import type { SettingsSection } from "@/components/settings/sections";
import { StaffSettings } from "@/components/settings/staff-settings";
import { FrameCard } from "@/components/shared/frame-card";

export function SettingsPage({ section }: { readonly section: SettingsSection }) {
  switch (section) {
    case "staff":
      return <StaffSettings />;
    case "receipts":
      return <ReceiptSettings />;
    case "data":
      return (
        <FrameCard title="Data on this device">
          <BackupSettings />
        </FrameCard>
      );
    case "licence":
      return <LicenceSettings />;
    case "general":
      return (
        <>
          <AppearanceSettings />
          <AboutSettings />
        </>
      );
  }
}
