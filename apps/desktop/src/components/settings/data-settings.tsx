import { BackupSettings } from "@/components/settings/backup-settings";
import { PublishSettings } from "@/components/settings/publish-settings";
import { FrameCard } from "@/components/shared/frame-card";

export function DataSettings() {
  return (
    <FrameCard title="Data on this device">
      <div className="flex flex-col gap-3">
        <PublishSettings />
        <BackupSettings />
      </div>
    </FrameCard>
  );
}
