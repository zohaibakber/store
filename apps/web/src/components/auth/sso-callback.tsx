import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { AuthCaptcha } from "@/components/auth/shared";
import { Spinner } from "@/components/ui/spinner";
import { settleOAuth } from "@/lib/clerk-flow";
import { useClerk, useSignIn, useSignUp } from "@/lib/clerk-runtime";

export function SsoCallback() {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const navigate = useNavigate();
  const hasRun = React.useRef(false);

  React.useEffect(() => {
    if (!clerk.loaded || hasRun.current) return;
    hasRun.current = true;
    void (async () => {
      try {
        const result = await settleOAuth({ clerk, signIn, signUp });
        if (result.kind === "continue") {
          await navigate({ to: result.path });
          return;
        }
        if (result.kind === "idle") await navigate({ to: "/sign-in" });
      } catch {
        await navigate({ to: "/sign-in" });
      }
    })();
  }, [clerk, navigate, signIn, signUp]);

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-muted-foreground">
      <Spinner aria-label="Finishing sign-in" className="size-6" />
      <AuthCaptcha />
    </div>
  );
}
