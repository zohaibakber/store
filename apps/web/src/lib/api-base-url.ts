const loopbackHost = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("127.")
  );
};

/**
 * Production browsers call `api.<site>` (`VITE_API_URL`). Non-prod stages and
 * local Vite serve `/api` on the page origin through the Website Worker (or
 * the Vite proxy), so a baked production API URL CORS-fails from `*.workers.dev`.
 */
export const resolveBrowserApiBaseUrl = ({
  configuredApiUrl,
  pageOrigin,
}: {
  readonly configuredApiUrl: string;
  readonly pageOrigin: string;
}) => {
  const configured = configuredApiUrl.trim().replace(/\/$/, "");
  if (!configured) return "";

  let page: URL;
  let api: URL;
  try {
    page = new URL(pageOrigin);
    api = new URL(configured);
  } catch {
    return "";
  }

  if (api.origin === page.origin) return "";
  if (loopbackHost(page.hostname)) return "";
  if (page.hostname.toLowerCase().endsWith(".workers.dev")) return "";

  const apiHost = api.hostname.toLowerCase();
  const pageHost = page.hostname.toLowerCase();
  if (apiHost.startsWith("api.") && pageHost === apiHost.slice("api.".length)) return configured;
  return "";
};
