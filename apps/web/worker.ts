/**
 * Website Worker entry for Cloudflare.Website.Vite.
 *
 * Client assets are served by the asset layer. `/api/*` is `runWorkerFirst`,
 * so those requests land here and are forwarded to the API Worker over a
 * service binding — the browser stays same-origin for cookies and sync.
 *
 * @see https://alchemy.run/cloudflare/frontend/vite-spa/
 * @see https://alchemy.run/cloudflare/frontend/vite/
 */
export type ApiFetcher = {
  fetch: (input: Request) => Response | Promise<Response>;
};

export const handleApiProxy = (request: Request, api: ApiFetcher) => api.fetch(request);

export default {
  fetch(request: Request, env: { readonly API: ApiFetcher }) {
    return handleApiProxy(request, env.API);
  },
};
