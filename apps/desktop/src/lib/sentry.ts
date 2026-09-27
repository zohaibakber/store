type SentrySdk = typeof import("@sentry/react");

const sentryDsn = () => import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";

// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults are
// permissive. This is the v10 `sendDefaultPii: false` baseline from the v11
// migration guide.
const piiKeyDeny = { deny: ["forwarded", "-ip", "remote-", "via", "-user"] };

let sdk: Promise<SentrySdk> | null = null;

/**
 * The SDK is several hundred kilobytes, so it only loads when a DSN is
 * configured; builds without one never download it.
 */
export const initClientSentry = () => {
  const dsn = sentryDsn();
  if (!dsn || sdk) return;
  sdk = import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.PROD ? "production" : "development",
      release: `tabaaq-web@${__APP_VERSION__}`,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: piiKeyDeny, response: piiKeyDeny },
        httpBodies: [],
        urlQueryParams: piiKeyDeny,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        graphQL: { document: false, variables: false },
      },
    });
    return Sentry;
  });
};

export const captureClientException = (
  error: Error,
  tags: Readonly<Record<string, string | undefined>>,
) => {
  void sdk?.then((Sentry) =>
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(tags)) if (value) scope.setTag(key, value);
      Sentry.captureException(error);
    }),
  );
};
