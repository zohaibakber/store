export const sentryOptions = () => {
  if (!__SENTRY_DSN__) return undefined;
  return {
    dsn: __SENTRY_DSN__,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-desktop@${__APP_VERSION__}`,
    tracePropagationTargets: [],
  };
};
