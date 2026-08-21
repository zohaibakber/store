import type { ReactNode } from "react";

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 [-webkit-app-region:drag] md:p-10 [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]">
      <div className="w-full max-w-sm [-webkit-app-region:no-drag]">{children}</div>
    </div>
  );
}
