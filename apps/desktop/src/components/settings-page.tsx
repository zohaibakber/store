import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export function SettingsPage() {
  return (
    <main className="p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Preferences</p>
          <h1 className="text-lg font-medium tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            This route is ready for your persistent Electron settings.
          </p>
        </header>

        <Card>
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
    </main>
  );
}
