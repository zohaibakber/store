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
