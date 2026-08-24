export const makeDesktopContentSecurityPolicy = (input: {
  readonly scheme: string;
  readonly apiOrigin: string;
  readonly authOrigin: string;
  readonly development: boolean;
}) => {
  const scriptSources = [
    "'self'",
    "'wasm-unsafe-eval'",
    "'unsafe-inline'",
    ...(input.development ? ["'unsafe-eval'"] : []),
    "https://challenges.cloudflare.com",
  ];
  const connectSources = [
    "'self'",
    input.apiOrigin,
    input.authOrigin,
    "https://*.powersync.journeyapps.com",
    "wss://*.powersync.journeyapps.com",
    ...(input.development ? ["ws:", "http://localhost:*"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: data: blob: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};
