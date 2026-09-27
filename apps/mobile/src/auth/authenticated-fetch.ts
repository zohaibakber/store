import type { SessionHttpClient } from "@store/workspace";

const targetOf = (input: RequestInfo | URL, apiBaseUrl: string) =>
  new URL(input instanceof Request ? input.url : input.toString(), `${apiBaseUrl}/`);

export const makeAuthenticatedFetch = (http: SessionHttpClient): typeof fetch => {
  const apiOrigin = new URL(`${http.apiBaseUrl}/`).origin;
  return async (input, init) => {
    if (targetOf(input, http.apiBaseUrl).origin !== apiOrigin) {
      throw new TypeError("Authenticated requests must go to the Tabaaq API.");
    }
    return http.apiFetch(input, init);
  };
};
