import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MAX_STAFF_PIN_LENGTH } from "@store/contracts";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { PageLoading } from "@/components/app/loading-spinner";
import { TitleBar, TitleBarEnd, TitleBarStart } from "@/components/app/title-bar";
import { WindowControls } from "@/components/app/window-controls";
import { BrandMark } from "@/components/brand-mark";
import { pinDigits } from "@/components/staff/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";

export function StaffScreen({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="flex h-svh min-h-0 flex-col overflow-hidden bg-background"
      data-slot="staff-screen"
    >
      <TitleBar>
        <TitleBarStart>
          <BrandMark className="size-5 rounded-sm" />
        </TitleBarStart>
        <span />
        <TitleBarEnd>
          <WindowControls />
        </TitleBarEnd>
      </TitleBar>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}

export function StaffScreenLoading() {
  return (
    <StaffScreen>
      <PageLoading />
    </StaffScreen>
  );
}

export function StaffScreenHeader({
  description,
  title,
}: {
  readonly description?: ReactNode;
  readonly title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1 className="text-lg font-medium">{title}</h1>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function PinInput({
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "onChange" | "type"> & {
  readonly onValueChange: (pin: string) => void;
}) {
  return (
    <Input
      autoComplete="off"
      inputMode="numeric"
      maxLength={MAX_STAFF_PIN_LENGTH}
      onChange={(event) => onValueChange(pinDigits(event.currentTarget.value))}
      type="password"
      {...props}
    />
  );
}

export function RecoveryCode({ code }: { readonly code: string }) {
  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => toastManager.add({ title: "Recovery code copied", type: "success" }),
      () => toastManager.add({ title: "Could not copy. Write the code down.", type: "error" }),
    );
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <output
        aria-label="Recovery code"
        className="text-center text-2xl font-medium tracking-widest break-all select-all"
        data-testid="recovery-code"
      >
        {code}
      </output>
      <Button onClick={copy} size="sm" type="button" variant="outline">
        <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
        Copy code
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        This code is the only way back in if the owner PIN is forgotten. It is shown once. Write it
        down and keep it away from this computer.
      </p>
    </div>
  );
}

export const WRITTEN_DOWN = "I have written it down";

export function useThrottle() {
  const [wait, setWait] = useState<{ readonly until: number; readonly now: number } | null>(null);
  const remainingMillis = wait === null ? 0 : Math.max(0, wait.until - wait.now);
  const waiting = remainingMillis > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(
      () => setWait((current) => (current === null ? null : { ...current, now: Date.now() })),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [waiting]);

  const start = (millis: number) => {
    const now = Date.now();
    setWait({ until: now + millis, now });
  };

  return { remainingMillis, start };
}
