const liveSocketOrigin = (apiOrigin: string): string => {
  const url = new URL(apiOrigin);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
};

export const makeDesktopContentSecurityPolicy = (input: {
  readonly scheme: string;
  readonly apiOrigin: string;
  readonly authOrigin: string;
  readonly development: boolean;
}) => {
  const scriptSources = [
    "'self'",
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
