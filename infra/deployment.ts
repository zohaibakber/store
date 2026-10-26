export const PRODUCTION_ZONE = "tabaaq.app";
export const PRODUCTION_API_HOSTNAME = `api.${PRODUCTION_ZONE}`;
export const PRODUCTION_AUTH_HOSTNAME = `auth.${PRODUCTION_ZONE}`;
export const PRODUCTION_API_URL = `https://${PRODUCTION_API_HOSTNAME}`;
export const PRODUCTION_AUTH_URL = `https://${PRODUCTION_AUTH_HOSTNAME}`;

export const LOCAL_API_PORT = 8787;
export const LOCAL_AUTH_PORT = 8788;
export const LOCAL_API_URL = `http://localhost:${LOCAL_API_PORT}`;
export const LOCAL_AUTH_URL = `http://localhost:${LOCAL_AUTH_PORT}`;

export const GOOGLE_OAUTH_CLIENT_ID =
  "54702143708-fhbababd6pq22q0qb1e52el891gvab2k.apps.googleusercontent.com";

export const DESKTOP_SENTRY_DSN =
  "https://e24746e77284fb88292d5249e1cde674@o4511967133106176.ingest.us.sentry.io/4511974822576128";

export const EDGE_WAF_ENABLED = false;
