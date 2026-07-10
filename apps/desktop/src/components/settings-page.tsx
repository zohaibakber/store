import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export function SettingsPage() {
  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-primary">Preferences</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-3 text-muted-foreground">
          This route is ready for your persistent Electron settings.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Application</CardTitle>
            <CardDescription>Choose how the desktop application behaves.</CardDescription>
          </CardHeader>
          <Separator />
          <label className="flex cursor-pointer items-center justify-between gap-6 p-6">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Desktop notifications
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Receive a notification when an order is placed.
              </span>
            </span>
            <Switch aria-label="Desktop notifications" />
          </label>
          <Separator />
          <label className="flex cursor-pointer items-center justify-between gap-6 p-6">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Launch on startup</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Open the store dashboard when you sign in.
              </span>
            </span>
            <Switch aria-label="Launch on startup" />
          </label>
        </Card>
      </div>
    </div>
  );
}
