export const isAllowedRendererNavigation = (
  url: string,
  allowedOrigins: ReadonlyArray<string>,
) => {
  let requested: URL;
  try {
    requested = new URL(url);
  } catch {
    return false;
  }
  return allowedOrigins.some((origin) => {
    if (!origin) return false;
    try {
      return requested.origin === new URL(origin).origin;
    } catch {
      return false;
    }
  });
};
