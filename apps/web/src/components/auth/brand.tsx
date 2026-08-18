import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

export function AuthBrand() {
  return (
    <span className="flex items-center gap-2 text-lg font-medium">
      <BrandMark className="size-6 rounded-md" />
      Tabaaq
    </span>
  );
}

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center px-4 [-webkit-app-region:drag]">
        <span className="[-webkit-app-region:no-drag]">
          <AuthBrand />
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center p-6 md:p-10">{children}</div>
    </div>
  );
}
