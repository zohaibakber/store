type SentrySdk = typeof import("@sentry/react");

const sentryDsn = () => import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";

const piiKeyDeny = { deny: ["forwarded", "-ip", "remote-", "via", "-user"] };

const dataCollectionWithoutDefaultPii = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: piiKeyDeny, response: piiKeyDeny },
  httpBodies: [],
  urlQueryParams: piiKeyDeny,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};

let sdk: Promise<SentrySdk> | null = null;

export const initClientSentry = () => {
  const dsn = sentryDsn();
  if (!dsn || sdk) return;
  sdk = import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.PROD ? "production" : "development",
      release: `tabaaq-web@${__APP_VERSION__}`,
      dataCollection: dataCollectionWithoutDefaultPii,
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
