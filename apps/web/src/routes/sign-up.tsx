import { createFileRoute } from "@tanstack/react-router";

import { SignUpForm } from "@/components/auth/sign-up-form";

export const Route = createFileRoute("/sign-up")({
  component: SignUpForm,
});
