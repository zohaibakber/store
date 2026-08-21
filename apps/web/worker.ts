/**
 * Website Worker entry for Cloudflare.Website.Vite.
 *
 * Client assets are served by the asset layer. `/api/*` and
 * `/__vite_module_runner/*` are `runWorkerFirst` so local alchemy/Vite
 * stay same-origin, and the module-runner WebSocket can upgrade.
 * Production browsers call the API Worker on
 * `api.<PRODUCTION_DOMAIN>` via `VITE_API_URL`.
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
