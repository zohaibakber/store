export const DEFAULT_ELECTRON_PROTOCOL = "com.tabaaq.desktop";
export const DEFAULT_MOBILE_PROTOCOL = "com.tabaaq.mobile";
export const ELECTRON_RENDERER_HOST = "app";

/**
 * GitHub Actions interpolates unset `vars.*` / `secrets.*` as `""`. Treat
 * blank values as missing so they cannot override a real default.
 */
export const fallbackIfBlank = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim() ?? "";
  return trimmed || fallback;
};

export const parseTrustedOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export interface AuthSecurityInput {
  readonly baseURL: string;
  readonly electronProtocol: string;
  readonly mobileProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export interface AuthSecurityConfig {
  readonly baseURL: string;
  readonly electronOrigin: string;
  readonly electronProtocol: string;
  readonly mobileOrigin: string;
  readonly mobileProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const secureWebOrigin = (value: string, label: string) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error(`${label} must be an origin without credentials, a path, query, or fragment.`);
  if (url.protocol !== "https:" && !localHosts.has(url.hostname))
    throw new Error(`${label} must use HTTPS outside local development.`);
  return url.origin;
};

const protocolScheme = (value: string, label: string) => {
  const normalized = value.replace(/:\/?$/, "");
  if (!/^[a-z][a-z0-9+.-]*$/.test(normalized))
    throw new Error(`${label} must be a valid URI scheme.`);
  return normalized;
};

export const resolveAuthSecurity = (input: AuthSecurityInput): AuthSecurityConfig => {
  const electronProtocol = protocolScheme(input.electronProtocol, "ELECTRON_PROTOCOL");
  const mobileProtocol = protocolScheme(input.mobileProtocol, "MOBILE_PROTOCOL");

  const baseURL = secureWebOrigin(input.baseURL, "API base URL");
  const electronOrigin = `${electronProtocol}://${ELECTRON_RENDERER_HOST}`;
  const trustedOrigins = [
    baseURL,
    ...input.trustedOrigins.map((origin) => secureWebOrigin(origin, "Trusted origin")),
    electronOrigin,
    `${mobileProtocol}://`,
    // Expo Go identifies the JavaScript bundle by its changing LAN origin.
    // Trust that scheme only while the API itself is in local HTTP development;
    // production never receives this wildcard.
    ...(baseURL.startsWith("https://") ? [] : ["exp://*"]),
  ];

  return {
    baseURL,
    electronOrigin,
    electronProtocol,
    mobileOrigin: `${mobileProtocol}://`,
    mobileProtocol,
    trustedOrigins: [...new Set(trustedOrigins)],
  };
};

export const clerkFrontendApiHostnameFromPublishableKey = (publishableKey: string): string => {
  const encodedFrontendApi = publishableKey.split("_").slice(2).join("_");
  const frontendApi = globalThis.atob(encodedFrontendApi).replace(/\$$/u, "");
  if (!frontendApi || frontendApi.includes("/")) {
    throw new Error("Clerk publishable key does not contain a Frontend API host.");
  }
  return new URL(`https://${frontendApi}`).hostname;
};

export const clerkTokenOptions = (template: string | undefined) =>
  template?.trim()
    ? ({ template: template.trim(), skipCache: true } as const)
    : ({ skipCache: true } as const);
