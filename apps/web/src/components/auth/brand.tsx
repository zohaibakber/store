import type { ReactNode } from "react";

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-0 h-10 [-webkit-app-region:drag]"
      />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}
