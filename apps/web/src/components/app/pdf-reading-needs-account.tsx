import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function PdfReadingNeedsAccount() {
  const { snapshot } = useAuth();
  if (snapshot?.status === "authenticated") return null;
  return (
    <Alert variant="info">
      <HugeiconsIcon aria-hidden="true" icon={InformationCircleIcon} />
      <AlertTitle>Reading PDF invoices needs an account</AlertTitle>
      <AlertDescription>CSV files import on this device without one.</AlertDescription>
      <AlertAction>
        <Button render={<Link to="/sign-in" />} size="xs" variant="outline">
          Sign in
        </Button>
      </AlertAction>
    </Alert>
  );
}
