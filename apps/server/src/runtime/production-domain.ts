/**
 * Production hostnames for the Website (apex) and API (`api.` subdomain).
 *
 * Site hostname precedence: `PRODUCTION_DOMAIN`, then the first
 * `AUTH_TRUSTED_ORIGINS` host, then the parent of an `api.*` `VITE_API_URL`.
 *
 * API hostname precedence: `PRODUCTION_API_DOMAIN`, then `VITE_API_URL` when it
 * is not the site host, then `api.${site}`. There is no baked product domain.
 */
export const PRODUCTION_DOMAIN_MISSING_MESSAGE =
  "Production hostname is not configured. Set PRODUCTION_DOMAIN (hostname only, e.g. example.com) on the Production GitHub Environment.";

export const PRODUCTION_API_DOMAIN_MISSING_MESSAGE =
  "Production API hostname is not configured. Set PRODUCTION_DOMAIN (API becomes api.<domain>), PRODUCTION_API_DOMAIN, or VITE_API_URL (https://api.example.com) on the Production GitHub Environment.";

export type ProductionDomainEnv = {
  readonly PRODUCTION_DOMAIN?: string;
  readonly PRODUCTION_API_DOMAIN?: string;
  readonly VITE_API_URL?: string;
  readonly AUTH_TRUSTED_ORIGINS?: string;
};

const unquote = (value: string) =>
  value
    .trim()
    .replace(/^['"]+/u, "")
    .replace(/['"]+$/u, "")
    .trim();

const hostnameFrom = (value: string | undefined): string | undefined => {
  const trimmed = unquote(value ?? "");
  if (!trimmed || /[*?]/u.test(trimmed)) return undefined;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
      return undefined;
    }
    return url.hostname;
  } catch {
    return undefined;
  }
};

const siteFromApiHostname = (hostname: string | undefined): string | undefined => {
  if (!hostname?.startsWith("api.")) return undefined;
  const parent = hostname.slice("api.".length);
  return parent.includes(".") ? parent : undefined;
};

export const resolveProductionHostname = (
  env: ProductionDomainEnv = process.env,
): string | undefined =>
  hostnameFrom(env.PRODUCTION_DOMAIN) ??
  (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(/[\s,]+/u)
    .map(hostnameFrom)
    .find(Boolean) ??
  siteFromApiHostname(hostnameFrom(env.VITE_API_URL));

export const resolveProductionApiHostname = (
  env: ProductionDomainEnv = process.env,
): string | undefined => {
  const site = resolveProductionHostname(env);
  const dedicated = hostnameFrom(env.PRODUCTION_API_DOMAIN);
  if (dedicated) return dedicated;
  const fromUrl = hostnameFrom(env.VITE_API_URL);
  if (fromUrl && fromUrl !== site) return fromUrl;
  return site ? `api.${site}` : undefined;
};

export const requireProductionHostname = (env: ProductionDomainEnv = process.env): string => {
  const hostname = resolveProductionHostname(env);
  if (!hostname) throw new Error(PRODUCTION_DOMAIN_MISSING_MESSAGE);
  return hostname;
};

export const requireProductionApiHostname = (env: ProductionDomainEnv = process.env): string => {
  const hostname = resolveProductionApiHostname(env);
  if (!hostname) throw new Error(PRODUCTION_API_DOMAIN_MISSING_MESSAGE);
  return hostname;
};

export const productionSiteOrigin = (
  env: ProductionDomainEnv = process.env,
): string | undefined => {
  const hostname = resolveProductionHostname(env);
  return hostname ? `https://${hostname}` : undefined;
};

export const productionApiOrigin = (env: ProductionDomainEnv = process.env): string | undefined => {
  const hostname = resolveProductionApiHostname(env);
  return hostname ? `https://${hostname}` : undefined;
};
