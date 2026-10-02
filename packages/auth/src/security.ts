import * as Result from "effect/Result";

export const DEFAULT_ELECTRON_PROTOCOL = "com.tabaaq.desktop";
export const DEFAULT_MOBILE_PROTOCOL = "com.tabaaq.mobile";
const DEFAULT_MOBILE_DEBUG_PROTOCOL = "com.tabaaq.mobile.debug";
export const ELECTRON_RENDERER_HOST = "app";

export const fallbackIfBlank = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim() ?? "";
  return trimmed || fallback;
};

export const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

const unquote = (value: string) =>
  value
    .trim()
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .trim();

const parseUrl = (value: string) =>
  Result.try({
    try: () => new URL(value),
    catch: (cause) =>
      cause instanceof Error ? cause.message : "is not an origin or origin pattern",
  });

export const publicHostnameFrom = (value: string | undefined): string | undefined => {
  const trimmed = unquote(value ?? "");
  if (!trimmed || /[*?]/.test(trimmed)) return undefined;
  return Result.match(parseUrl(trimmed.includes("://") ? trimmed : `https://${trimmed}`), {
    onFailure: () => undefined,
    onSuccess: ({ hostname }) =>
      !hostname || hostname === "localhost" || hostname.endsWith(".localhost")
        ? undefined
        : hostname,
  });
};

export const parseTrustedOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map(unquote)
    .filter(Boolean);

interface AuthSecurityInput {
  readonly baseURL: string;
  readonly electronProtocol: string;
  readonly mobileProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

interface RejectedTrustedOrigin {
  readonly value: string;
  readonly reason: string;
}

interface RejectedAuthSetting extends RejectedTrustedOrigin {
  readonly setting: string;
}

interface AuthSecurityConfig {
  readonly baseURL: string;
  readonly electronOrigin: string;
  readonly electronProtocol: string;
  readonly mobileOrigin: string;
  readonly mobileProtocol: string;
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly trustedRedirects: ReadonlyArray<string>;
  readonly rejectedSettings: ReadonlyArray<RejectedAuthSetting>;
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLoopbackHost = (host: string) => {
  const hostname = host
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const ipv4 = hostname.split(".");
  const isIpv4Loopback =
    ipv4.length === 4 &&
    ipv4[0] === "127" &&
    ipv4.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    isIpv4Loopback
  );
};

const secureWebOrigin = (value: string, label: string): Result.Result<string, string> =>
  Result.flatMap(parseUrl(value), (url) => {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return Result.fail(`${label} must use HTTP or HTTPS.`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      return Result.fail(
        `${label} must be an origin without credentials, a path, query, or fragment.`,
      );
    if (url.protocol !== "https:" && !localHosts.has(url.hostname))
      return Result.fail(`${label} must use HTTPS outside local development.`);
    return Result.succeed(url.origin);
  });

const schemePrefix = /^([a-z][a-z0-9+.-]*):\/\/?/i;
const wildcarded = /[*?]/;
const unusableSchemes = new Set(["about", "blob", "data", "file", "javascript", "vbscript"]);

type ClassifiedOrigin = { readonly origins: ReadonlyArray<string> } | { readonly reason: string };

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
    return { origins: [value] };
  }

  const host = (matched ? value.slice(matched[0].length) : value).replace(/\/+$/, "");
  if (!host || host.includes("/")) return { reason: "is not an origin or origin pattern" };
  if (protocol === "http" && !options.allowInsecure && !isLoopbackHost(host))
    return { reason: "must use HTTPS outside local development" };

  if (wildcarded.test(host)) {
    const labels = host.replace(/:.*$/, "").split(".");
    const literal = labels.filter((label) => !wildcarded.test(label));
    const loopback = options.allowInsecure && isLoopbackHost(host.replace(/[*?]/g, "0"));
    if (literal.length < 2 && !loopback) return { reason: "matches too many origins" };
    return { origins: [isWeb ? `${protocol}://${host}` : `https://${host}`] };
  }

  const secure = secureWebOrigin(`${isWeb ? protocol : "https"}://${host}`, "Trusted origin");
  if (Result.isFailure(secure)) return { reason: secure.failure };
  if (!options.allowInsecure || !isLoopbackHost(host)) return { origins: [secure.success] };
  const insecure = secureWebOrigin(`http://${host}`, "Trusted origin");
  if (Result.isFailure(insecure)) return { reason: insecure.failure };
  return { origins: [...new Set([secure.success, insecure.success])] };
};

interface ResolvedTrustedOrigins {
  readonly accepted: ReadonlyArray<string>;
  readonly rejected: ReadonlyArray<RejectedTrustedOrigin>;
}

const resolveTrustedOrigins = (
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

  const baseURL = Result.getOrThrowWith(
    secureWebOrigin(input.baseURL, "Auth base URL"),
    (reason) => new Error(reason),
  );
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
    `${DEFAULT_MOBILE_DEBUG_PROTOCOL}://`,
  ];

  return {
    baseURL,
    electronOrigin,
    electronProtocol,
    mobileOrigin: `${mobileProtocol}://`,
    mobileProtocol,
    secureCookies,
    trustedOrigins: [...new Set(trustedOrigins)],
    trustedRedirects: [...new Set([...trustedOrigins, `${electronProtocol}://`])],
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

const webOriginOf = (url: string) =>
  Result.match(parseUrl(url), {
    onFailure: () => null,
    onSuccess: ({ origin }) => (origin === "null" ? null : origin),
  });

const matchesTrustedOrigin = (origin: string | undefined, pattern: string) => {
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

const isHttpProtocol = (protocol: string) => protocol === "http:" || protocol === "https:";

export const isNativeRedirect = (redirectUri: string) =>
  Result.match(parseUrl(redirectUri), {
    onFailure: () => false,
    onSuccess: (url) => !isHttpProtocol(url.protocol),
  });

export const isTrustedRedirect = (redirectUri: string, patterns: ReadonlyArray<string>) =>
  Result.match(parseUrl(redirectUri), {
    onFailure: () => false,
    onSuccess: (url) =>
      isTrustedOrigin(isHttpProtocol(url.protocol) ? url.origin : redirectUri, patterns),
  });
