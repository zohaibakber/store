import * as React from "react";

import { reportError } from "@/lib/report-error";

type AppErrorBoundaryProps = {
  readonly children: React.ReactNode;
  readonly fallback: React.ReactNode;
};

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    reportError(error, { op: "render" });
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function AsyncBoundary({
  children,
  failed,
  fallback,
}: {
  readonly children: React.ReactNode;
  readonly failed?: React.ReactNode;
  readonly fallback: React.ReactNode;
}) {
  return (
    <AppErrorBoundary fallback={failed === undefined ? fallback : failed}>
      <React.Suspense fallback={fallback}>{children}</React.Suspense>
    </AppErrorBoundary>
  );
}
