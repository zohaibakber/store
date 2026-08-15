import { ELECTRON_RENDERER_HOST } from "@store/auth/security";

export const normalizeElectronOrigin = (request: Request, electronProtocol: string): Request => {
  const electronOrigin = request.headers.get("electron-origin");
  const origin = request.headers.get("origin");
  const expectedElectronOrigin = `${electronProtocol.replace(/:\/?$/, "")}://${ELECTRON_RENDERER_HOST}`;
  if (electronOrigin !== expectedElectronOrigin || (origin !== null && origin !== "null"))
    return request;

  // Cloudflare Request headers are immutable. Set Origin on a new Headers
  // object first so CORS and session lookup see the privileged renderer origin.
  const headers = new Headers(request.headers);
  headers.set("origin", expectedElectronOrigin);
  return new Request(request, { headers });
};
