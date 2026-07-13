export const withElectronOrigin = (request: Request, electronProtocol: string): Request => {
  const electronOrigin = request.headers.get("electron-origin");
  const origin = request.headers.get("origin");
  const expectedElectronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
  if (electronOrigin !== expectedElectronOrigin || (origin && origin !== "null")) return request;

  const headers = new Headers(request.headers);
  headers.set("origin", new URL(request.url).origin);
  return new Request(request, { headers });
};
