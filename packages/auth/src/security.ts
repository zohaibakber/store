export interface AuthSecurityInput {
  readonly baseURL: string;
  readonly electronProtocol: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export interface AuthSecurityConfig {
  readonly baseURL: string;
  readonly electronOrigin: string;
  readonly electronProtocol: string;
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const secretEntropy = (secret: string) => {
  const counts = new Map<string, number>();
  for (const character of secret) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / secret.length;
    return entropy - probability * Math.log2(probability) * secret.length;
  }, 0);
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

export const resolveAuthSecurity = (input: AuthSecurityInput): AuthSecurityConfig => {
  const secret = input.secret.trim();
  if (
    secret !== input.secret ||
    new TextEncoder().encode(secret).byteLength < 32 ||
    secretEntropy(secret) < 120
  )
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 high-entropy characters.");

  const electronProtocol = input.electronProtocol.replace(/:\/?$/, "");
  if (!/^[a-z][a-z0-9+.-]*$/.test(electronProtocol))
    throw new Error("ELECTRON_PROTOCOL must be a valid URI scheme.");

  const baseURL = secureWebOrigin(input.baseURL, "Better Auth base URL");
  const trustedOrigins = [
    baseURL,
    ...input.trustedOrigins.map((origin) => secureWebOrigin(origin, "Trusted origin")),
    `${electronProtocol}:/`,
  ];

  return {
    baseURL,
    electronOrigin: `${electronProtocol}:/`,
    electronProtocol,
    secureCookies: baseURL.startsWith("https://"),
    trustedOrigins: [...new Set(trustedOrigins)],
  };
};
