export const sentryOptions = () => {
  const dsn = (process.env["VITE_SENTRY_DSN"] ?? import.meta.env.VITE_SENTRY_DSN ?? "").trim();
  if (!dsn) return undefined;
  return {
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-desktop@${__APP_VERSION__}`,
    tracePropagationTargets: [],
  };
};
