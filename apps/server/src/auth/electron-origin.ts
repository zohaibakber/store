import { ELECTRON_RENDERER_HOST } from "@store/auth/security";

export const normalizeElectronOrigin = (request: Request, electronProtocol: string): Request => {
  const electronOrigin = request.headers.get("electron-origin");
  const origin = request.headers.get("origin");
  const expectedElectronOrigin = `${electronProtocol.replace(/:\/?$/, "")}://${ELECTRON_RENDERER_HOST}`;
  if (electronOrigin !== expectedElectronOrigin || (origin !== null && origin !== "null"))
    return request;

  // Cloudflare Request headers are immutable. Copy Origin onto a new Headers
  // object rather than calling `headers.set` on the incoming request.
  const headers = new Headers(request.headers);
  headers.set("origin", expectedElectronOrigin);
  return new Request(request, { headers });
};
