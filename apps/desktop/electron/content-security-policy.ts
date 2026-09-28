const liveSocketOrigin = (apiOrigin: string): string => {
  const url = new URL(apiOrigin);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
};

const LEGACY_POWERSYNC_WORKER = /^\/assets\/WASQLiteDB\.worker-[A-Za-z0-9_-]+\.js$/u;

export const isLegacyPowerSyncWorkerPath = (pathname: string) =>
  LEGACY_POWERSYNC_WORKER.test(pathname);

export const makeDesktopContentSecurityPolicy = (input: {
  readonly scheme: string;
  readonly apiOrigin: string;
  readonly authOrigin: string;
  readonly development: boolean;
  readonly wasm?: boolean;
}) => {
  const scriptSources = [
    "'self'",
    ...(input.wasm === true ? ["'wasm-unsafe-eval'"] : []),
    ...(input.development ? ["'unsafe-eval'", "'unsafe-inline'"] : []),
  ];
  const connectSources = [
    "'self'",
    input.apiOrigin,
    input.authOrigin,
    liveSocketOrigin(input.apiOrigin),
    "https://*.ingest.sentry.io",
    "https://*.ingest.us.sentry.io",
    ...(input.development ? ["ws:", "http://localhost:*"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: data: blob: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self'",
    "frame-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};
