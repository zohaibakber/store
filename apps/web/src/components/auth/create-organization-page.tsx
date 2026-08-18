import { AuthScreen } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreateOrganization } from "@/lib/clerk-runtime";
import { clerkPublishableKey } from "@/lib/clerk-workspace";

export function CreateOrganizationPage() {
  return (
    <AuthScreen>
      <div className="flex w-full flex-col items-center">
        {clerkPublishableKey ? (
          <CreateOrganization />
        ) : (
          <Alert className="w-full max-w-xs">
            <AlertTitle>Clerk is not configured</AlertTitle>
            <AlertDescription>
              Set VITE_CLERK_PUBLISHABLE_KEY so organization creation can load.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AuthScreen>
  );
}
