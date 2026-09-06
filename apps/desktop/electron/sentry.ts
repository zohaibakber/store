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
    integrations: (defaults) =>
      defaults.filter((integration) => {
        // ANR pauses the renderer to collect JS stacks; that turns a short
        // session-teardown stall into a frozen window.
        if (integration.name === "RendererEventLoopBlock") return false;
        // AppImage FUSE unmounts on quit/update leave crashpad mapped to a
        // gone file. Linux then SIGBUS and KDE reports chrome_crashpad_handler
        // as a fatal Tabaaq error.
        if (process.platform === "linux" && integration.name === "SentryMinidump") return false;
        return true;
      }),
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
