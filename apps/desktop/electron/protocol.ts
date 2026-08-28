import path from "node:path";
import { pathToFileURL } from "node:url";

import { ELECTRON_RENDERER_HOST } from "@store/auth/security";
import { net, protocol } from "electron";

export { makeDesktopContentSecurityPolicy } from "./content-security-policy";

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

export const developmentRendererTarget = (developmentServerUrl: string, requestUrl: URL) => {
  if (requestUrl.pathname.startsWith("//")) return null;
  const target = new URL(developmentServerUrl);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  target.hash = "";
  return target;
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
      const target = developmentRendererTarget(input.developmentServerUrl, requestUrl);
      if (!target) return new Response(null, { status: 404 });
      const init: RequestInit = {
        method: request.method,
        headers: stripHopByHopHeaders(request.headers),
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        // SAFETY: Electron's net.fetch follows Node's streaming-request contract,
        // whose required duplex extension is absent from the DOM RequestInit type.
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
