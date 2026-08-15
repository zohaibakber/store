import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  clerkFrontendApiHostnameFromPublishableKey,
  ELECTRON_RENDERER_HOST,
} from "@store/auth/security";
import { net, protocol } from "electron";

export const desktopRendererOrigin = (scheme: string) => `${scheme}://${ELECTRON_RENDERER_HOST}`;

export const desktopRendererUrl = (scheme: string) => `${desktopRendererOrigin(scheme)}/`;

export const registerDesktopSchemePrivileges = (scheme: string) => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
};

export const clerkFrontendApiHostname = (publishableKey: string | undefined) => {
  const key = publishableKey?.trim();
  if (!key) return undefined;
  try {
    return clerkFrontendApiHostnameFromPublishableKey(key);
  } catch {
    return undefined;
  }
};

export const makeDesktopContentSecurityPolicy = (input: {
  readonly scheme: string;
  readonly apiOrigin: string;
  readonly clerkFrontendApiHostname?: string;
  readonly development: boolean;
}) => {
  const clerkOrigin = input.clerkFrontendApiHostname
    ? `https://${input.clerkFrontendApiHostname}`
    : undefined;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(input.development ? ["'unsafe-eval'"] : []),
    ...(clerkOrigin ? [clerkOrigin] : []),
    "https://challenges.cloudflare.com",
  ];
  const connectSources = [
    "'self'",
    input.apiOrigin,
    ...(clerkOrigin ? [clerkOrigin] : []),
    ...(input.development ? ["ws:", "http://localhost:*"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: data: blob: https://img.clerk.com user-image:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};

const withContentSecurityPolicy = (response: Response, policy: string) => {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const stripHopByHopHeaders = (headers: Headers) => {
  const next = new Headers(headers);
  for (const name of [
    "host",
    "origin",
    "referer",
    "connection",
    "content-length",
    "accept-encoding",
    "upgrade-insecure-requests",
  ]) {
    next.delete(name);
  }
  for (const name of Array.from(next.keys())) {
    if (name.startsWith("sec-fetch-")) next.delete(name);
  }
  return next;
};

export const registerDesktopProtocolHandler = (input: {
  readonly scheme: string;
  readonly rendererRoot: string;
  readonly developmentServerUrl?: string;
  readonly contentSecurityPolicy: string;
}) => {
  protocol.handle(input.scheme, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== ELECTRON_RENDERER_HOST) {
      return new Response(null, { status: 404 });
    }

    if (input.developmentServerUrl) {
      const target = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        input.developmentServerUrl,
      );
      const init: RequestInit = {
        method: request.method,
        headers: stripHopByHopHeaders(request.headers),
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        (init as RequestInit & { duplex: "half" }).duplex = "half";
      }
      const response = await net.fetch(target.toString(), init);
      return withContentSecurityPolicy(response, input.contentSecurityPolicy);
    }

    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath =
      requestedPath === "/" || requestedPath === ""
        ? "index.html"
        : requestedPath.replace(/^\//, "");
    const filePath = path.normalize(path.join(input.rendererRoot, relativePath));
    const rendererRoot = path.normalize(input.rendererRoot);
    if (filePath !== rendererRoot && !filePath.startsWith(`${rendererRoot}${path.sep}`)) {
      return new Response(null, { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    return withContentSecurityPolicy(response, input.contentSecurityPolicy);
  });
};
