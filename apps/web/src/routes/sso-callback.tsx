import { createFileRoute } from "@tanstack/react-router";

import { SsoCallback } from "@/components/auth/sso-callback";

export const Route = createFileRoute("/sso-callback")({
  component: SsoCallback,
});
