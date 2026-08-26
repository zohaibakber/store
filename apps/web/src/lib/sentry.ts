import * as Sentry from "@sentry/react";

const sentryDsn = () => import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";

export const initClientSentry = () => {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-web@${__APP_VERSION__}`,
    sendDefaultPii: false,
  });
};

export { Sentry };
