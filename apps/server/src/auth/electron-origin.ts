export const normalizeElectronOrigin = (request: Request, electronProtocol: string): Request => {
  const electronOrigin = request.headers.get("electron-origin");
  const origin = request.headers.get("origin");
  const expectedElectronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
  if (electronOrigin !== expectedElectronOrigin || origin !== "null") return request;

  const headers = new Headers(request.headers);
  headers.delete("origin");
  return new Request(request, { headers });
};
