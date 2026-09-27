import * as Sentry from "@sentry/react";

const sentryDsn = () => import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";

// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults are
// permissive. This is the v10 `sendDefaultPii: false` baseline from the v11
// migration guide.
const piiKeyDeny = { deny: ["forwarded", "-ip", "remote-", "via", "-user"] };

export const initClientSentry = () => {
  const dsn = sentryDsn();
  if (!dsn) return;
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
};

export { Sentry };
