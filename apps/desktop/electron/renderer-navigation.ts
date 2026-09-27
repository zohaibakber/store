const sameProtocolAndHost = (left: URL, right: URL) =>
  left.protocol === right.protocol && left.host === right.host;

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
      return sameProtocolAndHost(requested, allowed);
    } catch {
      return false;
    }
  });
};
