export const DEFAULT_ELECTRON_PROTOCOL = "com.tabaaq.desktop";
export const DEFAULT_MOBILE_PROTOCOL = "com.tabaaq.mobile";
/** Host used with the privileged custom scheme so the renderer origin is `scheme://app`. */
export const ELECTRON_RENDERER_HOST = "app";

/**
 * GitHub Actions interpolates unset `vars.*` / `secrets.*` as `""`. Treat
 * blank values as missing so they cannot override a real default.
 */
export const fallbackIfBlank = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim() ?? "";
  return trimmed || fallback;
};

/** No origin holds a quote, so strip them wherever a value editor left them. */
const unquote = (value: string) =>
  value
    .trim()
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .trim();

/**
 * Splits the `AUTH_TRUSTED_ORIGINS` variable. Commas are the documented
 * separator; whitespace separates too, because a space-separated list is a
 * common way to write one and would otherwise arrive as a single unusable
 * entry. Wrapping quotes are stripped — shells and CI variable editors keep
 * them in the value.
 */
export const parseTrustedOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map(unquote)
    .filter(Boolean);

export interface AuthSecurityInput {
  readonly baseURL: string;
  readonly electronProtocol: string;
  readonly mobileProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

/** A configured origin that was dropped instead of being trusted. */
export interface RejectedTrustedOrigin {
  readonly value: string;
  readonly reason: string;
}

/** A deployment variable that was ignored instead of failing the deployment. */
export interface RejectedAuthSetting extends RejectedTrustedOrigin {
  readonly setting: string;
}

export interface AuthSecurityConfig {
  readonly baseURL: string;
  readonly electronOrigin: string;
  readonly electronProtocol: string;
  readonly mobileOrigin: string;
  readonly mobileProtocol: string;
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly rejectedSettings: ReadonlyArray<RejectedAuthSetting>;
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLoopbackHost = (host: string) => {
  const hostname = host
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
};

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

/**
 * A scheme, not `host:port`: an app origin always writes the slash
 * (`myapp://`, `com.tabaaq.desktop:/`), while `localhost:5173` must stay a host.
 */
const schemePrefix = /^([a-z][a-z0-9+.-]*):\/\/?/i;
const wildcarded = /[*?]/;
/** Schemes that address a document or script rather than an app. */
const unusableSchemes = new Set(["about", "blob", "data", "file", "javascript", "vbscript"]);

type ClassifiedOrigin = { readonly origins: ReadonlyArray<string> } | { readonly reason: string };

/**
 * CORS and native clients never parse a configured trusted origin as a URL —
 * they pattern match it. Documented values therefore include forms `new URL`
 * rejects outright: bare hosts (`app.example.com`), host wildcards
 * (`*.example.com`), and native scheme patterns (`exp://192.168.*.*:*`).
 * Classify an entry rather than parsing it, and drop what cannot be used, so
 * one unusable value can never throw out of Worker start-up.
 */
const classifyTrustedOrigin = (
  raw: string,
  options: { readonly allowInsecure: boolean },
): ClassifiedOrigin => {
  const value = unquote(raw);
  if (!value) return { reason: "is empty" };
  if (/[\s<>"'\\]/.test(value)) return { reason: "contains characters an origin cannot hold" };

  const matched = schemePrefix.exec(value);
  const protocol = matched?.[1]?.toLowerCase();
  const isWeb = protocol === "http" || protocol === "https";

  if (protocol !== undefined && !isWeb) {
    if (unusableSchemes.has(protocol)) return { reason: "is not an app origin" };
    // A native scheme (`com.tabaaq.desktop:/`, `myapp://`, `exp://…`) is matched
    // by glob or prefix, so it is trusted as written.
    return { origins: [value] };
  }

  const host = (matched ? value.slice(matched[0].length) : value).replace(/\/+$/, "");
  if (!host || host.includes("/")) return { reason: "is not an origin or origin pattern" };
  if (protocol === "http" && !options.allowInsecure && !isLoopbackHost(host))
    return { reason: "must use HTTPS outside local development" };

  if (wildcarded.test(host)) {
    // `*` or `*.com` would trust origins this deployment does not own. Require
    // two literal labels — what `*.example.com` has — unless it is a loopback
    // pattern such as `localhost:*` on a local deployment.
    const labels = host.replace(/:.*$/, "").split(".");
    const literal = labels.filter((label) => !wildcarded.test(label));
    const loopback = options.allowInsecure && isLoopbackHost(host.replace(/[*?]/g, "0"));
    if (literal.length < 2 && !loopback) return { reason: "matches too many origins" };
    return { origins: [isWeb ? `${protocol}://${host}` : `https://${host}`] };
  }

  // A bare host is resolved as HTTPS, plus HTTP for a loopback host, and only
  // while this deployment is itself local, so a production list never gains an
  // insecure origin nobody wrote.
  try {
    const secure = secureWebOrigin(`${isWeb ? protocol : "https"}://${host}`, "Trusted origin");
    if (!options.allowInsecure || !isLoopbackHost(host)) return { origins: [secure] };
    return {
      origins: [...new Set([secure, secureWebOrigin(`http://${host}`, "Trusted origin")])],
    };
  } catch (cause) {
    return {
      reason: cause instanceof Error ? cause.message : "is not an origin or origin pattern",
    };
  }
};

export interface ResolvedTrustedOrigins {
  readonly accepted: ReadonlyArray<string>;
  readonly rejected: ReadonlyArray<RejectedTrustedOrigin>;
}

/**
 * Classifies configured origins into the ones CORS can match and the ones it
 * cannot, so a caller can log the rejects instead of failing.
 */
export const resolveTrustedOrigins = (
  origins: ReadonlyArray<string>,
  options: { readonly allowInsecure: boolean },
): ResolvedTrustedOrigins => {
  const accepted: Array<string> = [];
  const rejected: Array<RejectedTrustedOrigin> = [];
  for (const origin of origins) {
    const classified = classifyTrustedOrigin(origin, options);
    if ("reason" in classified) rejected.push({ value: origin, reason: classified.reason });
    else accepted.push(...classified.origins);
  }
  return { accepted, rejected };
};

export const resolveAuthSecurity = (input: AuthSecurityInput): AuthSecurityConfig => {
  const rejectedSettings: Array<RejectedAuthSetting> = [];

  // A deployment variable nobody can validate before it ships falls back to the
  // code default rather than failing: the native clients lose their deep link,
  // while web and mobile sign-in keep working.
  const protocol = (value: string, setting: string, fallback: string) => {
    const normalized = value.replace(/:\/?$/, "");
    if (/^[a-z][a-z0-9+.-]*$/.test(normalized)) return normalized;
    rejectedSettings.push({ setting, value, reason: "is not a valid URI scheme" });
    return fallback;
  };
  const electronProtocol = protocol(
    input.electronProtocol,
    "ELECTRON_PROTOCOL",
    DEFAULT_ELECTRON_PROTOCOL,
  );
  const mobileProtocol = protocol(input.mobileProtocol, "MOBILE_PROTOCOL", DEFAULT_MOBILE_PROTOCOL);

  // The base URL is the deployment's own identity rather than operator input —
  // `apps/server/infra.ts` states it literally — so it stays fatal.
  const baseURL = secureWebOrigin(input.baseURL, "API base URL");
  const secureCookies = baseURL.startsWith("https://");

  const configured = resolveTrustedOrigins(input.trustedOrigins, {
    allowInsecure: !secureCookies,
  });
  for (const origin of configured.rejected)
    rejectedSettings.push({ setting: "AUTH_TRUSTED_ORIGINS", ...origin });

  const electronOrigin = `${electronProtocol}://${ELECTRON_RENDERER_HOST}`;
  const trustedOrigins = [
    baseURL,
    ...configured.accepted,
    electronOrigin,
    `${mobileProtocol}://`,
    // Expo Go identifies the JavaScript bundle by its changing LAN origin.
    // Trust that scheme only while the auth server itself is in local HTTP
    // development; production never receives this wildcard.
    ...(secureCookies ? [] : ["exp://*"]),
  ];

  return {
    baseURL,
    electronOrigin,
    electronProtocol,
    mobileOrigin: `${mobileProtocol}://`,
    mobileProtocol,
    secureCookies,
    trustedOrigins: [...new Set(trustedOrigins)],
    rejectedSettings,
  };
};

const globToRegExp = (pattern: string) => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*?";
        index += 1;
      } else source += "[^/]*?";
    } else if (character === "?") source += "[^/]";
    else source += character.replace(/[.*+?^${}()|[\]\\]/, "\\$&");
  }
  return new RegExp(`^${source}$`);
};

const webOriginOf = (url: string) => {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
};

/**
 * Matches wildcard and native-scheme entries the same way the CORS allowlist
 * and Clerk authorized parties do. Web patterns match the origin; native
 * schemes match by glob, or by prefix when the pattern holds no wildcard.
 */
export const matchesTrustedOrigin = (origin: string | undefined, pattern: string) => {
  // Effect's CORS middleware types the origin as a string but hands over
  // whatever the `Origin` header held, which is nothing on a same-origin
  // request.
  if (!origin) return false;
  const webOrigin = webOriginOf(origin);
  if (wildcarded.test(pattern)) {
    if (pattern.includes("://")) return globToRegExp(pattern).test(webOrigin ?? origin);
    if (webOrigin === null) return false;
    return globToRegExp(pattern).test(new URL(origin).host);
  }
  return webOrigin === null ? origin.startsWith(pattern) : webOrigin === pattern;
};

export const isTrustedOrigin = (origin: string | undefined, patterns: ReadonlyArray<string>) =>
  patterns.some((pattern) => matchesTrustedOrigin(origin, pattern));

/**
 * Clerk publishable keys encode the Frontend API host after the second `_`.
 * That host (for example `clerk.example.com` or `foo.clerk.accounts.dev`) is
 * what Electron CSP must allow — not the Account Portal host.
 */
export const clerkFrontendApiHostnameFromPublishableKey = (publishableKey: string): string => {
  try {
    const encodedFrontendApi = publishableKey.split("_").slice(2).join("_");
    const frontendApi = globalThis.atob(encodedFrontendApi).replace(/\$$/u, "");
    if (!frontendApi || frontendApi.includes("/")) {
      throw new Error("Clerk publishable key does not contain a Frontend API host.");
    }
    return new URL(`https://${frontendApi}`).hostname;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("Frontend API host")) throw cause;
    throw new Error("Clerk publishable key does not contain a Frontend API host.");
  }
};

export const clerkTokenOptions = (template: string | undefined) =>
  template?.trim()
    ? ({ template: template.trim(), skipCache: true } as const)
    : ({ skipCache: true } as const);

const CLERK_TOKEN_REFRESH_FALLBACK_MS = 30_000;
const CLERK_TOKEN_REFRESH_LEAD_MS = 15_000;
const CLERK_TOKEN_REFRESH_MIN_MS = 5_000;
const CLERK_TOKEN_REFRESH_MAX_MS = 45_000;

/** Schedules rotation shortly before the JWT expiry without trusting a fixed token lifetime. */
export const clerkTokenRefreshDelay = (token: string, now = Date.now()) => {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return CLERK_TOKEN_REFRESH_FALLBACK_MS;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(globalThis.atob(padded)) as { readonly exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))
      return CLERK_TOKEN_REFRESH_FALLBACK_MS;
    return Math.min(
      CLERK_TOKEN_REFRESH_MAX_MS,
      Math.max(CLERK_TOKEN_REFRESH_MIN_MS, payload.exp * 1_000 - now - CLERK_TOKEN_REFRESH_LEAD_MS),
    );
  } catch {
    return CLERK_TOKEN_REFRESH_FALLBACK_MS;
  }
};
