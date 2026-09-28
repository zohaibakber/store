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
      <ThemePicker />
    </FrameCard>
  );
}
