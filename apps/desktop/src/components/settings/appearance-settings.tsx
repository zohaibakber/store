import { ThemePicker } from "@/components/settings/theme-picker";
import { FrameCard } from "@/components/shared/frame-card";

export function AppearanceSettings() {
  return (
    <FrameCard>
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
