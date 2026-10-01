import { createFileRoute } from "@tanstack/react-router";

import { BackupSettings } from "@/components/settings/backup-settings";

export const Route = createFileRoute("/settings/backup")({
  component: BackupSettings,
  staticData: { breadcrumb: "Backup" },
});
