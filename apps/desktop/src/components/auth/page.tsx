import { WindowControls } from "@/components/app/window-controls";
import { AuthBrand } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { clerkAppearance, SignIn } from "@/lib/clerk-runtime";
import { clerkPublishableKey } from "@/lib/clerk-workspace";

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
        <WindowControls />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AuthBrand />
        <div className="flex w-full justify-center">
          <div className="w-full max-w-xs">
            {clerkPublishableKey ? (
              <SignIn appearance={clerkAppearance} routing="virtual" />
            ) : (
              <Alert>
                <AlertTitle>Clerk is not configured</AlertTitle>
                <AlertDescription>
                  Set VITE_CLERK_PUBLISHABLE_KEY so sign-in can load.
                </AlertDescription>
              </Alert>
            )}
            {bridgeError ? (
              <Alert className="mt-6">
                <AlertTitle>Offline sign-in is not ready</AlertTitle>
                <AlertDescription>{bridgeError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
