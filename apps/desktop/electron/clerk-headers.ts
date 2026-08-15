/**
 * Clerk's Electron SDK authenticates Frontend API requests with a native
 * Authorization header. Chromium also adds Origin for our standard custom
 * renderer scheme, but Clerk deliberately rejects requests carrying both.
 */
export const nativeClerkRequestHeaders = (
  url: string,
  headers: Readonly<Record<string, string>>,
  clerkFrontendApiHostname: string | undefined,
) => {
  if (!clerkFrontendApiHostname) return headers;

  let isClerkRequest = false;
  try {
    isClerkRequest = new URL(url).hostname === clerkFrontendApiHostname;
  } catch {
    return headers;
  }
  if (!isClerkRequest) return headers;

  const names = Object.keys(headers);
  if (!names.some((name) => name.toLowerCase() === "authorization")) return headers;

  const next = { ...headers };
  for (const name of names) {
    if (name.toLowerCase() === "origin") delete next[name];
  }
  return next;
};

export const nativeClerkResponseHeaders = (
  url: string,
  headers: Readonly<Record<string, ReadonlyArray<string>>>,
  clerkFrontendApiHostname: string | undefined,
  rendererOrigin: string,
) => {
  if (!clerkFrontendApiHostname) return headers;
  try {
    if (new URL(url).hostname !== clerkFrontendApiHostname) return headers;
  } catch {
    return headers;
  }

  if (Object.keys(headers).some((name) => name.toLowerCase() === "access-control-allow-origin")) {
    return headers;
  }

  return {
    ...headers,
    "Access-Control-Allow-Origin": [rendererOrigin],
  };
};
