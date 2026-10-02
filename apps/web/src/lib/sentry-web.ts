import { init } from "@sentry/react";

export const initWebSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return;
  init({
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-web@${__APP_VERSION__}`,
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "BrowserSession"),
  });
};
