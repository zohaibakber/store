import * as Sentry from "@sentry/electron/main";
import { app } from "electron";

export interface DesktopErrorContext {
  readonly op: string;
  readonly databasePath?: string;
}

const sentryDsn = () =>
  (process.env["VITE_SENTRY_DSN"] ?? import.meta.env.VITE_SENTRY_DSN ?? "").trim();

export const initDesktopSentry = () => {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: app.isPackaged ? "production" : "development",
    release: `tabaaq-desktop@${app.getVersion()}`,
    sendDefaultPii: false,
  });
};

export const reportDesktopError = (cause: unknown, context: DesktopErrorContext) => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  console.error(error, context);
  Sentry.withScope((scope) => {
    scope.setTag("op", context.op);
    if (context.databasePath) scope.setTag("databasePath", context.databasePath);
    Sentry.captureException(error);
  });
};
