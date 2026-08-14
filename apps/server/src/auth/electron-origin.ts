export const normalizeElectronOrigin = (request: Request, electronProtocol: string): Request => {
  const electronOrigin = request.headers.get("electron-origin");
  const origin = request.headers.get("origin");
  const expectedElectronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
  if (electronOrigin !== expectedElectronOrigin || (origin !== null && origin !== "null"))
    return request;

  // Cloudflare Request headers are immutable. Better Auth's Electron plugin
  // clones the request and calls `headers.set("origin", ...)`, which throws
  // TypeError there. Set Origin on a new Headers object first so the plugin
  // sees it already present and skips that mutation. Same pattern as Expo's
  // `expo-origin` forwarding.
  const headers = new Headers(request.headers);
  headers.set("origin", expectedElectronOrigin);
  return new Request(request, { headers });
};
