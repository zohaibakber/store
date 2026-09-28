import { createFileRoute } from "@tanstack/react-router";

import { ThemePicker } from "@/components/settings/theme-picker";
import { FrameCard } from "@/components/shared/frame-card";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceRoute,
  staticData: { breadcrumb: "Appearance" },
});

function AppearanceRoute() {
  return (
    <FrameCard title="Appearance">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">
            System follows this device’s light or dark setting.
          </p>
        </div>
        <ThemePicker />
      </div>
    </FrameCard>
  );
}
