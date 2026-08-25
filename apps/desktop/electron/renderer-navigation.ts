export const isAllowedRendererNavigation = (url: string, allowedOrigins: ReadonlyArray<string>) => {
  let requested: URL;
  try {
    requested = new URL(url);
  } catch {
    return false;
  }
  if (!requested.host) return false;
  return allowedOrigins.some((origin) => {
    if (!origin) return false;
    try {
      const allowed = new URL(origin);
      // Custom schemes report origin "null", so compare protocol and host.
      return requested.protocol === allowed.protocol && requested.host === allowed.host;
    } catch {
      return false;
    }
  });
};
