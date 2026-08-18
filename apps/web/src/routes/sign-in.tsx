import { createFileRoute } from "@tanstack/react-router";

import { SignInForm } from "@/components/auth/sign-in-form";

export const Route = createFileRoute("/sign-in")({
  component: SignInForm,
});
